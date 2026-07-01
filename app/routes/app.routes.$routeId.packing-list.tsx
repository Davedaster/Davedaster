import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import { formatEtaSlot } from "../lib/etaSlots";
import { getRoute } from "../lib/routeDrafts.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const routeId = params.routeId;

  if (!routeId) {
    throw new Response("Route not found", { status: 404 });
  }

  const route = await getRoute(routeId);

  if (!route) {
    throw new Response("Route not found", { status: 404 });
  }

  return json({ route, generatedAt: new Date().toISOString() });
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSlot(estimatedArrival: string | Date | null, slotMinutes = 60) {
  if (!estimatedArrival) {
    return "ETA pending";
  }

  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + slotMinutes * 60 * 1000);

  return formatEtaSlot(start, end);
}

function splitLineItems(summary?: string | null) {
  return (summary || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normaliseItemLabel(item: string) {
  return item.replace(/\s+/g, " ").trim();
}

function itemKey(item: string) {
  return normaliseItemLabel(item).toLowerCase();
}

function checkbox() {
  return <span className="tick-box" />;
}

export default function WarehousePackingList() {
  const { route, generatedAt } = useLoaderData<typeof loader>();
  const itemMap = new Map<string, { label: string; totalLines: number; stops: number[]; orders: string[] }>();

  for (const stop of route.stops) {
    for (const order of stop.deliveryGroup?.orders || []) {
      for (const item of splitLineItems(order.lineItemSummary)) {
        const key = itemKey(item);
        const existing = itemMap.get(key);

        if (existing) {
          existing.totalLines += 1;
          existing.stops.push(stop.orderIndex);
          existing.orders.push(order.shopifyOrderNumber);
        } else {
          itemMap.set(key, {
            label: normaliseItemLabel(item),
            totalLines: 1,
            stops: [stop.orderIndex],
            orders: [order.shopifyOrderNumber],
          });
        }
      }
    }
  }

  const items = Array.from(itemMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  const loadOrder = [...route.stops].sort((a, b) => b.orderIndex - a.orderIndex);
  const driver = route.driver;
  const vehicleName = driver?.vehicleName || "Vehicle not set";
  const registration = driver?.vehicleRegistration || "Registration not set";

  return (
    <main>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #f3f4f6; color: #111827; font-family: Arial, sans-serif; }
        main { padding: 24px; }
        h1, h2, h3, p { margin-top: 0; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border: 1px solid #111827; padding: 8px; text-align: left; vertical-align: top; }
        th { background: #e5e7eb; }
        .no-print { margin-bottom: 20px; display: flex; justify-content: space-between; gap: 12px; align-items: center; }
        .print-button { border: 0; border-radius: 10px; padding: 12px 16px; background: #509AE6; color: #ffffff; font-weight: 700; cursor: pointer; }
        .page { background: #ffffff; border: 1px solid #d1d5db; border-radius: 14px; padding: 20px; margin: 0 auto 18px; max-width: 1100px; }
        .page-break { break-after: page; page-break-after: always; }
        .brand { color: #509AE6; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; }
        .hero { display: grid; grid-template-columns: 1fr 280px; gap: 16px; align-items: start; border: 3px solid #111827; border-radius: 16px; padding: 18px; }
        .van-card { border: 3px solid #111827; border-radius: 14px; padding: 14px; text-align: center; }
        .van-label { font-size: 12px; color: #4b5563; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; }
        .reg { font-size: 34px; font-weight: 900; letter-spacing: 0.04em; margin: 0; }
        .meta-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
        .meta { border: 1px solid #d1d5db; border-radius: 10px; padding: 10px; }
        .meta strong { display: block; font-size: 12px; color: #4b5563; margin-bottom: 4px; }
        .section-title { font-size: 20px; margin-bottom: 10px; }
        .tick-box { display: inline-block; width: 20px; height: 20px; border: 2px solid #111827; vertical-align: middle; }
        .stop-card { border: 2px solid #111827; border-radius: 14px; padding: 16px; margin-bottom: 14px; break-inside: avoid; page-break-inside: avoid; }
        .stop-head { display: grid; grid-template-columns: 90px 1fr 190px; gap: 14px; align-items: start; }
        .stop-number { font-size: 48px; font-weight: 900; line-height: 1; }
        .note-box { border: 2px solid #f59e0b; background: #fffbeb; border-radius: 10px; padding: 10px; margin-top: 10px; }
        .check-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .check-line { border: 1px solid #111827; border-radius: 10px; padding: 12px; font-weight: 700; }
        .signature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 22px; }
        .signature { border-bottom: 2px solid #111827; height: 44px; }
        .footer { margin-top: 16px; color: #4b5563; font-size: 12px; }
        @media print {
          body { background: #ffffff; }
          main { padding: 0; }
          .no-print { display: none !important; }
          .page { border: 0; border-radius: 0; max-width: none; margin: 0; padding: 12mm; }
          .stop-card, tr, .check-line { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-print">
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Warehouse packing list</h1>
          <p style={{ margin: "6px 0 0", color: "#4b5563" }}>Print this page or save it as a PDF. It includes the warehouse pick list, van loading order and every stop sheet.</p>
        </div>
        <button className="print-button" onClick={() => window.print()}>Print or save PDF</button>
      </div>

      <section className="page page-break">
        <div className="hero">
          <div>
            <p className="brand">Bathroom Panels Direct</p>
            <h1 style={{ fontSize: 34, marginBottom: 8 }}>Warehouse Packing List</h1>
            <h2 style={{ fontSize: 24, marginBottom: 10 }}>{route.name}</h2>
            <p style={{ fontSize: 16, marginBottom: 0 }}>{formatDate(route.date)}</p>
          </div>
          <div className="van-card">
            <div className="van-label">Van</div>
            <p className="reg">{registration}</p>
            <p style={{ margin: "8px 0 0", fontWeight: 700 }}>{vehicleName}</p>
          </div>
        </div>

        <div className="meta-grid">
          <div className="meta"><strong>Driver</strong>{driver?.name || "No driver assigned"}</div>
          <div className="meta"><strong>Driver phone</strong>{driver?.phoneNumber || "Not set"}</div>
          <div className="meta"><strong>Total drops</strong>{route.stops.length}</div>
          <div className="meta"><strong>Generated</strong>{formatDateTime(generatedAt)}</div>
          <div className="meta"><strong>Start</strong>{route.startAddress || "Bathroom Panels Direct"}</div>
          <div className="meta"><strong>Finish</strong>{route.finishAddress || "Bathroom Panels Direct"}</div>
          <div className="meta"><strong>Start time</strong>{route.plannedStartTime || "05:00"}</div>
          <div className="meta"><strong>Route status</strong>{route.status}</div>
        </div>

        <h2 className="section-title" style={{ marginTop: 24 }}>Warehouse pick summary</h2>
        {items.length ? (
          <table>
            <thead>
              <tr>
                <th style={{ width: 55 }}>Pick</th>
                <th>Item</th>
                <th style={{ width: 90 }}>Qty lines</th>
                <th>Stops</th>
                <th>Orders</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.label}>
                  <td>{checkbox()}</td>
                  <td><strong>{item.label}</strong></td>
                  <td>{item.totalLines}</td>
                  <td>{Array.from(new Set(item.stops)).sort((a, b) => a - b).join(", ")}</td>
                  <td>{Array.from(new Set(item.orders)).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No item details are stored against this route yet.</p>
        )}

        <h2 className="section-title" style={{ marginTop: 24 }}>Load van in this order</h2>
        <p style={{ marginBottom: 10 }}>Load the last drop first. Keep Drop 1 nearest the rear doors.</p>
        <table>
          <thead>
            <tr>
              <th style={{ width: 80 }}>Loaded</th>
              <th style={{ width: 90 }}>Drop</th>
              <th>Orders</th>
              <th>Customer</th>
              <th>Postcode</th>
            </tr>
          </thead>
          <tbody>
            {loadOrder.map((stop) => {
              const orders = stop.deliveryGroup?.orders || [];
              return (
                <tr key={stop.id}>
                  <td>{checkbox()}</td>
                  <td><strong>{stop.orderIndex}</strong></td>
                  <td>{orders.map((order) => order.shopifyOrderNumber).join(", ") || "No orders"}</td>
                  <td>{orders.map((order) => order.customerName).filter(Boolean).join(", ") || "No customer"}</td>
                  <td>{stop.deliveryGroup?.postcode || "No postcode"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2 className="section-title" style={{ marginTop: 24 }}>Final warehouse checks</h2>
        <div className="check-grid">
          <div className="check-line">{checkbox()} All panels loaded</div>
          <div className="check-line">{checkbox()} All trims loaded</div>
          <div className="check-line">{checkbox()} Adhesives loaded</div>
          <div className="check-line">{checkbox()} Silicone loaded</div>
          <div className="check-line">{checkbox()} Route checked against orders</div>
          <div className="check-line">{checkbox()} Driver paperwork issued</div>
        </div>
        <div className="signature-grid">
          <div><div className="signature" /><p>Loaded by</p></div>
          <div><div className="signature" /><p>Checked by</p></div>
          <div><div className="signature" /><p>Time</p></div>
        </div>
        <p className="footer">Route: {route.name} · Van: {registration}</p>
      </section>

      <section className="page">
        <h2 className="section-title">Stop by stop packing sheets</h2>
        {route.stops.map((stop) => {
          const group = stop.deliveryGroup;
          const orders = group?.orders || [];
          const customerNames = orders.map((order) => order.customerName).filter(Boolean).join(", ") || "Customer name missing";
          const orderNumbers = orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";
          const phone = orders.map((order) => order.customerPhone).filter(Boolean)[0] || "No phone";
          const address = group?.formattedAddress || group?.address || "No address";
          const lineItems = orders.flatMap((order) => splitLineItems(order.lineItemSummary));
          const notes = [group?.deliveryNote, group?.safePlaceNote].filter(Boolean).join(" · ");

          return (
            <article key={stop.id} className="stop-card">
              <div className="stop-head">
                <div>
                  <p style={{ marginBottom: 4, color: "#4b5563", fontWeight: 700 }}>Drop</p>
                  <div className="stop-number">{stop.orderIndex}</div>
                </div>
                <div>
                  <h3 style={{ fontSize: 22, marginBottom: 8 }}>{customerNames}</h3>
                  <p><strong>Order:</strong> {orderNumbers}</p>
                  <p><strong>Address:</strong> {address}</p>
                  <p><strong>Postcode:</strong> {group?.postcode || "No postcode"}</p>
                  <p><strong>Phone:</strong> {phone}</p>
                </div>
                <div>
                  <p><strong>ETA:</strong> {formatSlot(stop.estimatedArrival, route.customerSlotMinutes || 60)}</p>
                  <p><strong>Status:</strong> {stop.status}</p>
                  <p><strong>Van:</strong> {registration}</p>
                </div>
              </div>

              {notes ? <div className="note-box"><strong>Important notes:</strong> {notes}</div> : null}

              <h4 style={{ margin: "14px 0 8px", fontSize: 16 }}>Items to load for this drop</h4>
              {lineItems.length ? (
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 55 }}>Load</th>
                      <th>Item</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, index) => (
                      <tr key={`${stop.id}-${item}-${index}`}>
                        <td>{checkbox()}</td>
                        <td><strong>{item}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>No item details stored for this stop.</p>
              )}
            </article>
          );
        })}
        <p className="footer">Route: {route.name} · Van: {registration}</p>
      </section>
    </main>
  );
}
