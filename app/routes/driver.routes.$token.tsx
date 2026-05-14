import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";

import { buildWazeUrl } from "../lib/waze";
import { canStartDriverRoute, getDriverRouteByToken, startDriverRouteFromToken } from "../lib/driverRouteAccess.server";
import { formatEtaSlot } from "../lib/etaSlots.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = params.token;

  if (!token) {
    throw new Response("Driver route not found", { status: 404 });
  }

  const route = await getDriverRouteByToken(token);

  if (!route) {
    throw new Response("Driver route not found", { status: 404 });
  }

  return json({
    route,
    token,
    canStart: canStartDriverRoute(route.date),
  });
};

export const action = async ({ params }: ActionFunctionArgs) => {
  const token = params.token;

  if (!token) {
    throw new Response("Driver route not found", { status: 404 });
  }

  try {
    await startDriverRouteFromToken(token);
    return redirect(`/driver/routes/${token}`);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Route could not be started." }, { status: 400 });
  }
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatStart(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSlot(estimatedArrival: string | Date | null) {
  if (!estimatedArrival) {
    return "Target arrival pending";
  }

  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return formatEtaSlot(start, end);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").toLowerCase();
}

function splitLineItems(summary?: string | null) {
  return (summary || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function DriverRoutePage() {
  const { route, canStart } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const firstEta = route.stops.find((stop) => stop.estimatedArrival)?.estimatedArrival || route.date;
  const routeStarted = route.status === "OUT_FOR_DELIVERY" || route.status === "COMPLETED";
  const plannedStartText = formatStart(firstEta);
  const pins = route.stops.filter((stop) => typeof stop.deliveryGroup?.latitude === "number" && typeof stop.deliveryGroup?.longitude === "number");

  return (
    <main style={{ minHeight: "100vh", background: "#f4f7fb", fontFamily: "Arial, sans-serif", color: "#323841" }}>
      <section style={{ maxWidth: 980, margin: "0 auto", padding: "20px 14px 36px" }}>
        <header style={{ background: "#ffffff", borderRadius: 18, padding: 18, boxShadow: "0 10px 28px rgba(50,56,65,0.12)", marginBottom: 14 }}>
          <p style={{ margin: "0 0 8px", color: "#509AE6", fontWeight: 700 }}>Bathroom Panels Direct</p>
          <h1 style={{ margin: 0, fontSize: 27, lineHeight: 1.15 }}>{route.driver?.name || "Driver"}</h1>
          <p style={{ margin: "8px 0 0", color: "#667085" }}>{route.name}</p>
          <p style={{ margin: "8px 0 0", color: "#667085" }}>This route is planned to start at {plannedStartText}</p>
          <p style={{ margin: "8px 0 0", fontWeight: 700 }}>Status: {statusLabel(route.status)}</p>
        </header>

        <section style={{ background: "#ffffff", borderRadius: 18, padding: 14, boxShadow: "0 8px 24px rgba(50,56,65,0.08)", marginBottom: 14 }}>
          <div style={{ minHeight: 320, borderRadius: 14, background: "linear-gradient(180deg, #e8f3ff 0%, #d6ecff 100%)", border: "1px solid #d0d5dd", position: "relative", overflow: "hidden" }}>
            <span style={{ position: "absolute", top: 14, left: 14, background: "#ffffff", padding: "7px 10px", borderRadius: 999, fontWeight: 700, fontSize: 13 }}>Route map</span>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden="true">
              <path d="M12 72 C28 54 39 76 51 55 C64 34 72 44 88 23" fill="none" stroke="#509AE6" strokeWidth="1.2" strokeDasharray="3 2" />
            </svg>
            {pins.map((stop, index) => (
              <div key={stop.id} style={{ position: "absolute", left: `${18 + ((index * 13) % 66)}%`, top: `${70 - ((index * 11) % 48)}%`, transform: "translate(-50%, -100%)" }}>
                <div style={{ width: 34, height: 34, borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)", background: stop.status === "DELIVERED" ? "#16a34a" : "#509AE6", border: "3px solid white", boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
                  <span style={{ display: "grid", placeItems: "center", height: "100%", transform: "rotate(45deg)", color: "#ffffff", fontSize: 13, fontWeight: 700 }}>{stop.orderIndex}</span>
                </div>
              </div>
            ))}
          </div>
          <p style={{ margin: "10px 0 0", color: "#667085", fontSize: 14 }}>Zoomable live map comes in the next map milestone. This view already shows the route order and pins.</p>
        </section>

        <section style={{ background: "#ffffff", borderRadius: 18, padding: 14, boxShadow: "0 8px 24px rgba(50,56,65,0.08)", marginBottom: 14 }}>
          {actionData && "error" in actionData ? (
            <p style={{ margin: "0 0 10px", color: "#b42318", fontWeight: 700 }}>{actionData.error}</p>
          ) : null}
          {routeStarted ? (
            <p style={{ margin: 0, fontWeight: 700, color: "#16a34a" }}>Route started. Customer tracking can now become active.</p>
          ) : (
            <Form method="post">
              <button
                type="submit"
                disabled={!canStart}
                style={{ width: "100%", border: 0, borderRadius: 14, padding: "14px 16px", background: canStart ? "#509AE6" : "#d0d5dd", color: canStart ? "#ffffff" : "#667085", fontSize: 16, fontWeight: 700 }}
              >
                Start route
              </button>
              {!canStart ? (
                <p style={{ margin: "10px 0 0", color: "#667085" }}>This route can only be started on {formatDate(route.date)}.</p>
              ) : null}
            </Form>
          )}
        </section>

        <section style={{ display: "grid", gap: 14 }}>
          {route.stops.map((stop) => {
            const group = stop.deliveryGroup;
            const customerName = group?.orders.map((order) => order.customerName).filter(Boolean).join(", ") || "Customer name missing";
            const orders = group?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";
            const lineItems = group?.orders.flatMap((order) => splitLineItems(order.lineItemSummary)) || [];
            const phone = group?.orders.map((order) => order.customerPhone).filter(Boolean)[0] || "";
            const address = group?.formattedAddress || group?.address || "No address";
            const wazeUrl = buildWazeUrl(group);
            const isDelivered = stop.status === "DELIVERED";

            return (
              <article key={stop.id} style={{ background: isDelivered ? "#ecfdf3" : "#ffffff", border: isDelivered ? "1px solid #86efac" : "1px solid #e5e7eb", borderRadius: 18, padding: 16, boxShadow: "0 8px 24px rgba(50,56,65,0.08)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 20 }}>Drop {stop.orderIndex}</h2>
                    <p style={{ margin: "6px 0 0", color: "#667085" }}>{formatSlot(stop.estimatedArrival)}</p>
                  </div>
                  <span style={{ background: isDelivered ? "#16a34a" : "#eff6ff", color: isDelivered ? "#ffffff" : "#509AE6", borderRadius: 999, padding: "6px 10px", fontSize: 13, fontWeight: 700 }}>{statusLabel(stop.status)}</span>
                </div>

                <div style={{ marginTop: 14, display: "grid", gap: 9 }}>
                  <p style={{ margin: 0 }}><strong>Customer:</strong> {customerName}</p>
                  <p style={{ margin: 0 }}><strong>Order:</strong> {orders}</p>
                  <p style={{ margin: 0 }}><strong>Mobile:</strong> {phone ? <a href={`tel:${phone}`} style={{ color: "#509AE6", fontWeight: 700 }}>{phone}</a> : "No phone"}</p>
                  <p style={{ margin: 0 }}><strong>Address:</strong> {address}</p>
                  <button type="button" onClick={(event) => { navigator.clipboard.writeText(address); const target = event.currentTarget; target.innerText = "Address copied"; setTimeout(() => { target.innerText = "Copy address"; }, 1200); }} style={{ border: "1px solid #d0d5dd", background: "#ffffff", borderRadius: 12, padding: "10px 12px", fontWeight: 700 }}>Copy address</button>
                  <div>
                    <strong>Items:</strong>
                    {lineItems.length ? (
                      <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                        {lineItems.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: "6px 0 0", color: "#667085" }}>No item details stored for this order.</p>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                  {wazeUrl ? <a href={wazeUrl} target="_blank" rel="noreferrer" style={{ textAlign: "center", borderRadius: 12, padding: "11px 10px", background: "#509AE6", color: "#ffffff", fontWeight: 700, textDecoration: "none" }}>Open map</a> : null}
                  <button type="button" disabled style={{ border: 0, borderRadius: 12, padding: "11px 10px", background: "#eef2f7", color: "#667085", fontWeight: 700 }}>Add photos</button>
                  <button type="button" disabled style={{ border: 0, borderRadius: 12, padding: "11px 10px", background: "#fee4e2", color: "#b42318", fontWeight: 700 }}>Missed delivery</button>
                  <button type="button" disabled style={{ border: 0, borderRadius: 12, padding: "11px 10px", background: "#dcfce7", color: "#166534", fontWeight: 700 }}>Complete</button>
                </div>
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}
