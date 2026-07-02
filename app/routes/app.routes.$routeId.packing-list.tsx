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

function parseItem(item: string) {
  const normalised = item.replace(/\s+/g, " ").trim();
  const trailingQty = normalised.match(/^(.*?)(?:\s+[x×]\s*)(\d+)$/i);

  if (trailingQty) {
    return {
      label: trailingQty[1].trim(),
      quantity: Number(trailingQty[2]),
      original: normalised,
    };
  }

  const leadingQty = normalised.match(/^(\d+)(?:\s*[x×]\s+)(.*)$/i);

  if (leadingQty) {
    return {
      label: leadingQty[2].trim(),
      quantity: Number(leadingQty[1]),
      original: normalised,
    };
  }

  return {
    label: normalised,
    quantity: 1,
    original: normalised,
  };
}

function itemKey(item: string) {
  return parseItem(item).label.toLowerCase();
}

function combineLineItems(lineItems: string[]) {
  const itemMap = new Map<string, { label: string; quantity: number }>();

  for (const item of lineItems) {
    const parsed = parseItem(item);
    const key = itemKey(item);
    const quantity = Number.isFinite(parsed.quantity) ? parsed.quantity : 1;
    const existing = itemMap.get(key);

    if (existing) {
      existing.quantity += quantity;
    } else {
      itemMap.set(key, { label: parsed.label, quantity });
    }
  }

  return Array.from(itemMap.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function checkbox() {
  return <span className="tick-box" />;
}

export default function WarehousePackingList() {
  const { route, generatedAt } = useLoaderData<typeof loader>();
  const itemMap = new Map<string, { label: string; quantity: number; stops: number[]; orders: string[] }>();

  for (const stop of route.stops) {
    for (const order of stop.deliveryGroup?.orders || []) {
      for (const item of splitLineItems(order.lineItemSummary)) {
        const parsed = parseItem(item);
        const key = itemKey(item);
        const existing = itemMap.get(key);

        if (existing) {
          existing.quantity += Number.isFinite(parsed.quantity) ? parsed.quantity : 1;
          existing.stops.push(stop.orderIndex);
          existing.orders.push(order.shopifyOrderNumber);
        } else {
          itemMap.set(key, {
            label: parsed.label,
            quantity: Number.isFinite(parsed.quantity) ? parsed.quantity : 1,
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
  const totalOrders = route.stops.reduce((count, stop) => count + (stop.deliveryGroup?.orders.length || 0), 0);
  const getLoadPosition = (dropNumber: number) => Math.max(1, route.stops.length - dropNumber + 1);

  return (
    <main>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #f2f2f2; color: #000; font-family: Arial, Helvetica, sans-serif; }
        main { padding: 20px; }
        h1, h2, h3, h4, p { margin-top: 0; }
        p { margin-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #000; padding: 5px 6px; text-align: left; vertical-align: top; }
        th { background: #e8e8e8; color: #000; font-weight: 900; }
        .no-print { margin: 0 auto 18px; max-width: 1000px; display: flex; justify-content: space-between; gap: 12px; align-items: center; }
        .print-button { border: 2px solid #000; border-radius: 4px; padding: 10px 14px; background: #fff; color: #000; font-weight: 900; cursor: pointer; }
        .page { background: #fff; border: 1px solid #000; padding: 14mm; margin: 0 auto 18px; max-width: 1000px; min-height: 277mm; }
        .page-break { break-after: page; page-break-after: always; }
        .brand-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .brand-mark { border: 2px solid #000; color: #000; font-size: 17px; font-weight: 900; line-height: 1; padding: 7px 9px; letter-spacing: .04em; }
        .brand { color: #333; font-size: 13px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; }
        .route-note { display: inline-block; margin-top: 7px; border: 1px solid #000; padding: 4px 7px; font-size: 11px; font-weight: 900; text-transform: uppercase; }
        .hero { display: grid; grid-template-columns: 1fr 250px; gap: 14px; align-items: stretch; border: 2px solid #000; padding: 12px; background: #f7f7f7; }
        .van-card { border: 3px solid #000; background: #fff; padding: 10px; text-align: center; }
        .van-label { font-size: 11px; text-transform: uppercase; font-weight: 900; margin-bottom: 4px; }
        .reg { font-size: 34px; font-weight: 900; letter-spacing: 0.04em; margin: 0; }
        .meta-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; margin-top: 10px; }
        .meta { border: 1px solid #000; padding: 6px; font-size: 12px; min-height: 42px; }
        .meta strong { display: block; font-size: 10px; text-transform: uppercase; margin-bottom: 3px; }
        .section-title { font-size: 18px; margin: 14px 0 7px; }
        .tick-box { display: inline-block; width: 15px; height: 15px; border: 2px solid #000; vertical-align: middle; margin-right: 4px; }
        .pick-table td:nth-child(3), .drop-item-qty { font-size: 18px; font-weight: 900; text-align: center; }
        .loading-rule { border: 2px solid #000; padding: 8px 10px; margin-top: 12px; font-size: 13px; font-weight: 900; }
        .check-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
        .check-line { border: 1px solid #000; padding: 7px; font-size: 12px; font-weight: 900; }
        .signature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 16px; font-size: 12px; }
        .signature { border-bottom: 2px solid #000; height: 34px; }
        .loading-position { font-size: 19px; font-weight: 900; }
        .drop-pack-title { display: flex; justify-content: space-between; align-items: end; gap: 12px; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; }
        .drop-card { border: 2px solid #000; padding: 8px; margin-bottom: 8px; min-height: 72mm; break-inside: avoid; page-break-inside: avoid; }
        .drop-head { display: grid; grid-template-columns: 78px 1fr 145px; gap: 8px; border-bottom: 1px solid #000; padding-bottom: 6px; margin-bottom: 6px; }
        .drop-label { font-size: 10px; text-transform: uppercase; font-weight: 900; margin-bottom: 2px; }
        .drop-number { font-size: 40px; font-weight: 900; line-height: 1; }
        .drop-name { font-size: 17px; font-weight: 900; margin-bottom: 4px; }
        .drop-meta { font-size: 12px; }
        .drop-item-table { font-size: 12px; margin-top: 4px; }
        .drop-item-table th, .drop-item-table td { padding: 4px 5px; }
        .drop-total { display: inline-block; border: 1px solid #000; padding: 4px 6px; margin: 4px 0 0; font-size: 12px; font-weight: 900; }
        .notes { border: 1px solid #000; padding: 5px; margin-top: 6px; font-size: 12px; min-height: 22px; }
        .loaded-line { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid #000; padding-top: 6px; margin-top: 6px; font-size: 12px; font-weight: 900; }
        .footer { margin-top: 8px; font-size: 10px; color: #333; }
        @page { size: A4 portrait; margin: 8mm; }
        @media print {
          body { background: #fff; }
          main { padding: 0; }
          .no-print { display: none !important; }
          .page { border: 0; max-width: none; margin: 0; padding: 0; min-height: auto; }
          .page-break { break-after: page; page-break-after: always; }
          .drop-card, tr, .check-line { break-inside: avoid; page-break-inside: avoid; }
          .drop-card { break-before: auto; page-break-before: auto; }
        }
      `}</style>

      <div className="no-print">
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Warehouse packing list</h1>
          <p style={{ margin: "6px 0 0" }}>Black and white warehouse pack with a master pick list, loading order and unsplit drop cards.</p>
        </div>
        <button className="print-button" onClick={() => window.print()}>Print or save PDF</button>
      </div>

      <section className="page page-break">
        <div className="hero">
          <div>
            <div className="brand-row">
              <div className="brand-mark">BPD</div>
              <p className="brand">Bathroom Panels Direct</p>
            </div>
            <h1 style={{ fontSize: 30, marginBottom: 6 }}>Warehouse Packing List</h1>
            <h2 style={{ fontSize: 21, marginBottom: 8 }}>{route.name}</h2>
            <p style={{ fontSize: 15, marginBottom: 0 }}>{formatDate(route.date)}</p>
            <span className="route-note">{route.status === "DRAFT" ? "Draft route, check before loading" : `${route.status} route`}</span>
          </div>
          <div className="van-card">
            <div className="van-label">Van registration</div>
            <p className="reg">{registration}</p>
            <p style={{ margin: "7px 0 0", fontWeight: 900 }}>{vehicleName}</p>
          </div>
        </div>

        <div className="meta-grid">
          <div className="meta"><strong>Driver</strong>{driver?.name || "No driver assigned"}</div>
          <div className="meta"><strong>Driver phone</strong>{driver?.phoneNumber || "Not set"}</div>
          <div className="meta"><strong>Total drops</strong>{route.stops.length}</div>
          <div className="meta"><strong>Total orders</strong>{totalOrders}</div>
          <div className="meta"><strong>Generated</strong>{formatDateTime(generatedAt)}</div>
          <div className="meta"><strong>Start</strong>{route.startAddress || "Bathroom Panels Direct"}</div>
          <div className="meta"><strong>Finish</strong>{route.finishAddress || "Bathroom Panels Direct"}</div>
          <div className="meta"><strong>Start time</strong>{route.plannedStartTime || "05:00"}</div>
        </div>

        <h2 className="section-title">Master pick list</h2>
        {items.length ? (
          <table className="pick-table">
            <thead>
              <tr>
                <th style={{ width: 42 }}>Pick</th>
                <th>Item</th>
                <th style={{ width: 70 }}>Qty</th>
                <th style={{ width: 120 }}>Drops</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.label}>
                  <td>{checkbox()}</td>
                  <td><strong>{item.label}</strong></td>
                  <td>{item.quantity}</td>
                  <td>{Array.from(new Set(item.stops)).sort((a, b) => a - b).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No item details are stored against this route yet.</p>
        )}

        <div className="loading-rule">Loading rule: load by Load Position. Position 1 goes onto the van first. Drop 1 stays nearest the rear doors.</div>

        <h2 className="section-title">Final warehouse checks</h2>
        <div className="check-grid">
          <div className="check-line">{checkbox()} Panels loaded</div>
          <div className="check-line">{checkbox()} Trims loaded</div>
          <div className="check-line">{checkbox()} Adhesives loaded</div>
          <div className="check-line">{checkbox()} Silicone loaded</div>
          <div className="check-line">{checkbox()} Route checked</div>
          <div className="check-line">{checkbox()} Paperwork issued</div>
        </div>
        <div className="signature-grid">
          <div><div className="signature" /><p>Picked by</p></div>
          <div><div className="signature" /><p>Checked by</p></div>
          <div><div className="signature" /><p>Time</p></div>
        </div>
        <p className="footer">Route: {route.name} · Van: {registration} · Orders: {totalOrders}</p>
      </section>

      <section className="page page-break">
        <h2 className="section-title" style={{ marginTop: 0 }}>Loading order</h2>
        <p style={{ marginBottom: 8 }}>Follow Load Position from top to bottom. The drop cards remain in normal route order.</p>
        <table>
          <thead>
            <tr>
              <th style={{ width: 52 }}>Done</th>
              <th style={{ width: 100 }}>Load Position</th>
              <th style={{ width: 70 }}>Drop</th>
              <th>Orders</th>
              <th>Customer</th>
              <th style={{ width: 95 }}>Postcode</th>
            </tr>
          </thead>
          <tbody>
            {loadOrder.map((stop) => {
              const orders = stop.deliveryGroup?.orders || [];
              return (
                <tr key={stop.id}>
                  <td>{checkbox()}</td>
                  <td className="loading-position">{getLoadPosition(stop.orderIndex)}</td>
                  <td><strong>{stop.orderIndex}</strong></td>
                  <td>{orders.map((order) => order.shopifyOrderNumber).join(", ") || "No orders"}</td>
                  <td>{orders.map((order) => order.customerName).filter(Boolean).join(", ") || "No customer"}</td>
                  <td>{stop.deliveryGroup?.postcode || "No postcode"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="footer">Route: {route.name} · Van: {registration}</p>
      </section>

      <section className="page drop-pages">
        <div className="drop-pack-title">
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>Drop cards</h2>
            <p style={{ margin: "4px 0 0" }}>Printed in route order. Each order card is kept together on the page where possible.</p>
          </div>
          <strong>Van: {registration}</strong>
        </div>

        {route.stops.map((stop) => {
          const group = stop.deliveryGroup;
          const orders = group?.orders || [];
          const customerNames = orders.map((order) => order.customerName).filter(Boolean).join(", ") || "Customer name missing";
          const orderNumbers = orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";
          const address = group?.formattedAddress || group?.address || "No address";
          const lineItems = combineLineItems(orders.flatMap((order) => splitLineItems(order.lineItemSummary)));
          const itemTotal = lineItems.reduce((total, item) => total + item.quantity, 0);
          const notes = [group?.deliveryNote, group?.safePlaceNote].filter(Boolean).join(" · ");
          const loadPosition = getLoadPosition(stop.orderIndex);

          return (
            <article key={stop.id} className="drop-card">
              <div className="drop-head">
                <div>
                  <p className="drop-label">Drop</p>
                  <div className="drop-number">{stop.orderIndex}</div>
                </div>
                <div className="drop-meta">
                  <div className="drop-name">{customerNames}</div>
                  <p><strong>Order:</strong> {orderNumbers}</p>
                  <p><strong>Address:</strong> {address}</p>
                  <p><strong>Postcode:</strong> {group?.postcode || "No postcode"}</p>
                </div>
                <div className="drop-meta">
                  <p><strong>Load Position:</strong></p>
                  <p className="loading-position">{loadPosition}</p>
                  <p><strong>ETA:</strong> {formatSlot(stop.estimatedArrival, route.customerSlotMinutes || 60)}</p>
                  <p><strong>Van:</strong> {registration}</p>
                </div>
              </div>

              <h4 style={{ margin: "0 0 5px", fontSize: 13 }}>Items for this drop</h4>
              {lineItems.length ? (
                <table className="drop-item-table">
                  <thead>
                    <tr>
                      <th style={{ width: 42 }}>Pick</th>
                      <th>Item</th>
                      <th style={{ width: 70 }}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item) => (
                      <tr key={`${stop.id}-${item.label}`}>
                        <td>{checkbox()}</td>
                        <td><strong>{item.label}</strong></td>
                        <td className="drop-item-qty">{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>No item details stored for this stop.</p>
              )}
              <div className="drop-total">Total items for drop: {itemTotal || "Not stored"}</div>

              <div className="notes"><strong>Notes:</strong> {notes || ""}</div>
              <div className="loaded-line">
                <span>{checkbox()} Picked</span>
                <span>{checkbox()} Loaded</span>
                <span>Checked by: ____________________</span>
              </div>
            </article>
          );
        })}
        <p className="footer">Route: {route.name} · Van: {registration} · Orders: {totalOrders}</p>
      </section>
    </main>
  );
}
