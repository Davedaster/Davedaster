import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { useEffect } from "react";

import { getRoute } from "../lib/routeDrafts.server";

type PackedItem = {
  label: string;
  quantity: number;
};

type PackingDrop = {
  id: string;
  dropNumber: number;
  customerNames: string;
  orderNumbers: string;
  items: PackedItem[];
};

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const routeId = params.routeId;

  if (!routeId) throw new Response("Route not found", { status: 404 });

  const route = await getRoute(routeId);

  if (!route) throw new Response("Route not found", { status: 404 });

  return json({
    routeName: route.name,
    routeDate: route.date,
    driverName: route.driver?.name || "No driver assigned",
    drops: buildPackingDrops(route),
    totals: buildRouteTotals(route),
  });
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function splitLineItems(summary?: string | null) {
  return (summary || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parseItem(item: string): PackedItem {
  const normalised = item.replace(/\s+/g, " ").trim();
  const trailingQty = normalised.match(/^(.*?)(?:\s+[x×]\s*)(\d+)$/i);
  if (trailingQty) return { label: trailingQty[1].trim(), quantity: Number(trailingQty[2]) };

  const leadingQty = normalised.match(/^(\d+)(?:\s*[x×]\s+)(.*)$/i);
  if (leadingQty) return { label: leadingQty[2].trim(), quantity: Number(leadingQty[1]) };

  return { label: normalised, quantity: 1 };
}

function itemKey(item: string) {
  return parseItem(item).label.toLowerCase();
}

function combineLineItems(lineItems: string[]) {
  const itemMap = new Map<string, PackedItem>();

  for (const item of lineItems) {
    const parsed = parseItem(item);
    const quantity = Number.isFinite(parsed.quantity) ? parsed.quantity : 1;
    const existing = itemMap.get(itemKey(item));

    if (existing) {
      existing.quantity += quantity;
    } else {
      itemMap.set(itemKey(item), { label: parsed.label, quantity });
    }
  }

  return Array.from(itemMap.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function buildPackingDrops(route: any): PackingDrop[] {
  return [...(route.stops || [])]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((stop) => {
      const orders = stop.deliveryGroup?.orders || [];
      const customerNames = orders.map((order: any) => order.customerName).filter(Boolean).join(", ") || "Customer name missing";
      const orderNumbers = orders.map((order: any) => order.shopifyOrderNumber).filter(Boolean).join(", ") || "No linked orders";
      const items = combineLineItems(orders.flatMap((order: any) => splitLineItems(order.lineItemSummary)));

      return {
        id: stop.id,
        dropNumber: stop.orderIndex,
        customerNames,
        orderNumbers,
        items,
      };
    });
}

function buildRouteTotals(route: any) {
  const allItems = (route.stops || []).flatMap((stop: any) =>
    (stop.deliveryGroup?.orders || []).flatMap((order: any) => splitLineItems(order.lineItemSummary)),
  );

  return combineLineItems(allItems);
}

function itemText(items: PackedItem[]) {
  if (!items.length) return "No item details stored for this drop.";

  return items.map((item) => `${item.quantity} × ${item.label}`).join(", ");
}

export default function PackingListPrintPage() {
  const { routeName, routeDate, driverName, drops, totals } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const shouldPrint = searchParams.get("print") === "1";

  useEffect(() => {
    if (!shouldPrint) return;

    const timer = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(timer);
  }, [shouldPrint]);

  return (
    <main className="packing-page">
      <style>{`
        :root {
          color: #202223;
          font-family: Arial, Helvetica, sans-serif;
        }

        body {
          margin: 0;
          background: #f6f6f7;
        }

        .packing-page {
          max-width: 1100px;
          margin: 0 auto;
          padding: 24px;
        }

        .screen-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          margin-bottom: 18px;
        }

        .screen-actions a,
        .screen-actions button {
          border: 1px solid #babfc3;
          border-radius: 8px;
          background: #ffffff;
          color: #202223;
          font-size: 14px;
          font-weight: 700;
          padding: 10px 14px;
          text-decoration: none;
          cursor: pointer;
        }

        .screen-actions button.primary {
          border-color: #509AE6;
          background: #509AE6;
          color: #ffffff;
        }

        .sheet {
          background: #ffffff;
          border: 1px solid #dde0e4;
          border-radius: 14px;
          padding: 28px;
          box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
        }

        .brand {
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin: 0 0 8px;
        }

        h1 {
          font-size: 30px;
          line-height: 1.15;
          margin: 0 0 18px;
        }

        h2 {
          font-size: 18px;
          margin: 30px 0 12px;
        }

        .route-meta {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 24px;
        }

        .meta-box {
          border: 1px solid #dde0e4;
          border-radius: 10px;
          padding: 10px 12px;
        }

        .meta-label {
          display: block;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #6d7175;
          margin-bottom: 4px;
        }

        .meta-value {
          font-size: 15px;
          font-weight: 700;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }

        th {
          background: #f1f2f3;
          font-size: 12px;
          text-align: left;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        th,
        td {
          border: 1px solid #c9cccf;
          padding: 10px;
          vertical-align: top;
        }

        td {
          font-size: 13px;
          line-height: 1.35;
        }

        .tick-col {
          width: 42px;
          text-align: center;
        }

        .drop-col {
          width: 58px;
          text-align: center;
          font-weight: 800;
        }

        .customer-col {
          width: 19%;
        }

        .order-col {
          width: 14%;
        }

        .items-col {
          width: auto;
        }

        .checkbox {
          display: inline-block;
          width: 17px;
          height: 17px;
          border: 2px solid #202223;
          border-radius: 3px;
        }

        .items {
          font-weight: 700;
        }

        .totals-table {
          max-width: 680px;
        }

        .totals-table .qty-col {
          width: 90px;
          text-align: center;
          font-weight: 800;
        }

        .empty {
          border: 1px dashed #babfc3;
          border-radius: 10px;
          padding: 16px;
          color: #6d7175;
        }

        @page {
          size: A4;
          margin: 12mm;
        }

        @media print {
          body {
            background: #ffffff;
          }

          .packing-page {
            max-width: none;
            padding: 0;
          }

          .screen-actions {
            display: none;
          }

          .sheet {
            border: 0;
            border-radius: 0;
            padding: 0;
            box-shadow: none;
          }

          h1 {
            font-size: 26px;
            margin-bottom: 14px;
          }

          h2 {
            break-after: avoid;
            page-break-after: avoid;
          }

          tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          th,
          td {
            padding: 7px 8px;
          }
        }
      `}</style>

      <div className="screen-actions">
        <a href={`/app/routes`}>Back to routes</a>
        <button className="primary" type="button" onClick={() => window.print()}>Print packing list</button>
      </div>

      <section className="sheet" aria-label="BPD route packing list">
        <p className="brand">Bathroom Panels Direct</p>
        <h1>BPD Route Packing List</h1>

        <div className="route-meta">
          <div className="meta-box">
            <span className="meta-label">Route</span>
            <span className="meta-value">{routeName}</span>
          </div>
          <div className="meta-box">
            <span className="meta-label">Route date</span>
            <span className="meta-value">{formatDate(routeDate)}</span>
          </div>
          <div className="meta-box">
            <span className="meta-label">Driver</span>
            <span className="meta-value">{driverName}</span>
          </div>
        </div>

        <h2>Packing list</h2>
        {drops.length ? (
          <table>
            <thead>
              <tr>
                <th className="tick-col">✓</th>
                <th className="drop-col">Drop</th>
                <th className="customer-col">Customer</th>
                <th className="order-col">Order No.</th>
                <th className="items-col">What to pack</th>
              </tr>
            </thead>
            <tbody>
              {drops.map((drop) => (
                <tr key={drop.id}>
                  <td className="tick-col"><span className="checkbox" aria-hidden="true" /></td>
                  <td className="drop-col">{drop.dropNumber}</td>
                  <td className="customer-col">{drop.customerNames}</td>
                  <td className="order-col">{drop.orderNumbers}</td>
                  <td className="items-col items">{itemText(drop.items)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">No drops are saved against this route yet.</p>
        )}

        <h2>Route totals</h2>
        {totals.length ? (
          <table className="totals-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="qty-col">Qty</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((item) => (
                <tr key={item.label}>
                  <td className="items">{item.label}</td>
                  <td className="qty-col">{item.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">No item totals are stored against this route yet.</p>
        )}
      </section>
    </main>
  );
}
