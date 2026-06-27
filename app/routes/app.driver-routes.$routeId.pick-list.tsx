import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import { getDriverRoute } from "../lib/driverRoutes.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const routeId = params.routeId;

  if (!routeId) {
    throw new Response("Route not found", { status: 404 });
  }

  const route = await getDriverRoute(routeId);

  if (!route) {
    throw new Response("Route not found", { status: 404 });
  }

  return json({ route });
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function splitLineItems(summary?: string | null) {
  return (summary || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function itemKey(item: string) {
  return item.toLowerCase().replace(/\s+/g, " ").trim();
}

export default function PrintablePickingList() {
  const { route } = useLoaderData<typeof loader>();
  const itemMap = new Map<string, { label: string; count: number; stops: number[]; orders: string[] }>();

  for (const stop of route.stops) {
    for (const order of stop.deliveryGroup?.orders || []) {
      for (const item of splitLineItems(order.lineItemSummary)) {
        const key = itemKey(item);
        const existing = itemMap.get(key);

        if (existing) {
          existing.count += 1;
          existing.stops.push(stop.orderIndex);
          existing.orders.push(order.shopifyOrderNumber);
        } else {
          itemMap.set(key, {
            label: item,
            count: 1,
            stops: [stop.orderIndex],
            orders: [order.shopifyOrderNumber],
          });
        }
      }
    }
  }

  const items = Array.from(itemMap.values()).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <main style={{ fontFamily: "Arial, sans-serif", color: "#111827", padding: 24 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-print" style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Print picking list</h1>
          <p style={{ margin: "6px 0 0", color: "#4b5563" }}>Use this before loading the van.</p>
        </div>
        <button onClick={() => window.print()} style={{ border: 0, borderRadius: 10, padding: "12px 16px", background: "#509AE6", color: "#ffffff", fontWeight: 700, cursor: "pointer" }}>
          Print
        </button>
      </div>

      <section style={{ border: "2px solid #111827", borderRadius: 16, padding: 18, marginBottom: 18 }}>
        <p style={{ margin: "0 0 6px", color: "#509AE6", fontWeight: 700 }}>Bathroom Panels Direct</p>
        <h2 style={{ margin: 0, fontSize: 28 }}>{route.name}</h2>
        <p style={{ margin: "8px 0 0", fontSize: 16 }}>{formatDate(route.date)}</p>
        <p style={{ margin: "8px 0 0", fontSize: 16 }}>Driver: {route.driver?.name || "No driver assigned"}</p>
        <p style={{ margin: "8px 0 0", fontSize: 16 }}>{route.stops.length} stops · {items.length} unique item lines</p>
      </section>

      {items.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", border: "1px solid #111827", padding: 10, background: "#f3f4f6" }}>Picked</th>
              <th style={{ textAlign: "left", border: "1px solid #111827", padding: 10, background: "#f3f4f6" }}>Item</th>
              <th style={{ textAlign: "left", border: "1px solid #111827", padding: 10, background: "#f3f4f6" }}>Qty lines</th>
              <th style={{ textAlign: "left", border: "1px solid #111827", padding: 10, background: "#f3f4f6" }}>Stops</th>
              <th style={{ textAlign: "left", border: "1px solid #111827", padding: 10, background: "#f3f4f6" }}>Orders</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.label}>
                <td style={{ border: "1px solid #111827", padding: 10, width: 70 }}><span style={{ display: "inline-block", width: 20, height: 20, border: "2px solid #111827" }} /></td>
                <td style={{ border: "1px solid #111827", padding: 10, fontWeight: 700 }}>{item.label}</td>
                <td style={{ border: "1px solid #111827", padding: 10 }}>{item.count}</td>
                <td style={{ border: "1px solid #111827", padding: 10 }}>{Array.from(new Set(item.stops)).sort((a, b) => a - b).join(", ")}</td>
                <td style={{ border: "1px solid #111827", padding: 10 }}>{Array.from(new Set(item.orders)).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <section style={{ border: "2px solid #111827", borderRadius: 16, padding: 18 }}>
          <h2 style={{ marginTop: 0 }}>No item details stored</h2>
          <p style={{ marginBottom: 0 }}>This route has stops and orders, but no stored line item summary to print yet.</p>
        </section>
      )}
    </main>
  );
}
