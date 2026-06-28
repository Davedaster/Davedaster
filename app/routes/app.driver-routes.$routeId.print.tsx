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

function formatTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSlot(estimatedArrival: string | Date | null) {
  if (!estimatedArrival) {
    return "ETA pending";
  }

  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return `${formatTime(start)} - ${formatTime(end)}`;
}

function splitLineItems(summary?: string | null) {
  return (summary || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function PrintableRouteLabels() {
  const { route } = useLoaderData<typeof loader>();

  return (
    <main style={{ fontFamily: "Arial, sans-serif", color: "#111827", padding: 24 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
          article { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-print" style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Print route labels</h1>
          <p style={{ margin: "6px 0 0", color: "#4b5563" }}>Use your browser print button or press Ctrl/Cmd + P.</p>
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
        <p style={{ margin: "8px 0 0", fontSize: 16 }}>{route.stops.length} stops</p>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {route.stops.map((stop) => {
          const group = stop.deliveryGroup;
          const orders = group?.orders || [];
          const customerNames = orders.map((order) => order.customerName).filter(Boolean).join(", ") || "Customer name missing";
          const orderNumbers = orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";
          const phone = orders.map((order) => order.customerPhone).filter(Boolean)[0] || "No phone";
          const address = group?.formattedAddress || group?.address || "No address";
          const lineItems = orders.flatMap((order) => splitLineItems(order.lineItemSummary));

          return (
            <article key={stop.id} style={{ border: "2px solid #111827", borderRadius: 14, padding: 16, minHeight: 300 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 14, color: "#4b5563" }}>Stop</p>
                  <h3 style={{ margin: 0, fontSize: 42 }}>{stop.orderIndex}</h3>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: 0, fontWeight: 700 }}>{formatSlot(stop.estimatedArrival)}</p>
                  <p style={{ margin: "6px 0 0", color: "#4b5563" }}>{stop.status}</p>
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <p style={{ margin: 0 }}><strong>Order:</strong> {orderNumbers}</p>
                <p style={{ margin: 0 }}><strong>Customer:</strong> {customerNames}</p>
                <p style={{ margin: 0 }}><strong>Phone:</strong> {phone}</p>
                <p style={{ margin: 0 }}><strong>Postcode:</strong> {group?.postcode || "No postcode"}</p>
                <p style={{ margin: 0 }}><strong>Address:</strong> {address}</p>
              </div>

              <div style={{ marginTop: 12, borderTop: "1px solid #d1d5db", paddingTop: 10 }}>
                <strong>Items</strong>
                {lineItems.length ? (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                    {lineItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                  </ul>
                ) : (
                  <p style={{ margin: "8px 0 0", color: "#4b5563" }}>No item details stored.</p>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
