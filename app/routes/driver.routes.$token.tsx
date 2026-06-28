import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";

import { RouteMap } from "../components/RouteMap";
import { getOfflineShopifyAdmin } from "../lib/driverShopifyAdmin.server";
import { buildWazeUrl } from "../lib/waze";
import {
  canStartDriverRoute,
  completeDriverStopFromToken,
  getDriverRouteByToken,
  markDriverStopMissedFromToken,
  startDriverRouteFromToken,
} from "../lib/driverRouteAccess.server";
import { formatEtaSlot } from "../lib/etaSlots.server";
import { uploadProofPhoto } from "../lib/proofPhotoStorage.server";
import { completeReturnTicketFromDriverToken } from "../lib/returns.server";

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

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const token = params.token;

  if (!token) {
    throw new Response("Driver route not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "startRoute");

  try {
    if (intent === "startRoute") {
      await startDriverRouteFromToken(token);
      return redirect(`/driver/routes/${token}`);
    }

    if (intent === "collectReturnTicket") {
      const ticketId = String(formData.get("ticketId") || "").trim();
      const quantities: Record<string, number> = {};
      let collectionPhotoUrl: string | null = null;
      const collectionPhotoFile = formData.get("collectionPhotoFile");

      for (const [key, value] of formData.entries()) {
        if (key.startsWith("quantityCollected_")) {
          quantities[key.replace("quantityCollected_", "")] = Number(value || 0);
        }
      }

      if (collectionPhotoFile instanceof File && collectionPhotoFile.size > 0) {
        collectionPhotoUrl = await uploadProofPhoto(collectionPhotoFile, `return-${ticketId}`);
      }

      await completeReturnTicketFromDriverToken(token, {
        ticketId,
        quantities,
        collectionPhotoUrl,
        customerSignature: String(formData.get("customerSignature") || "").trim(),
        driverNote: String(formData.get("driverNote") || "").trim(),
      });

      return redirect(`/driver/routes/${token}#next-stop`);
    }

    const stopId = String(formData.get("stopId") || "").trim();

    if (!stopId) {
      throw new Error("Stop is missing.");
    }

    if (intent === "completeStop") {
      const proofPhotoFiles = formData.getAll("proofPhotoFiles").filter((file): file is File => file instanceof File && file.size > 0);
      const proofPhotoUrls: string[] = [];

      for (const proofPhotoFile of proofPhotoFiles) {
        proofPhotoUrls.push(await uploadProofPhoto(proofPhotoFile, stopId));
      }

      const admin = await getOfflineShopifyAdmin();
      await completeDriverStopFromToken({
        token,
        stopId,
        admin,
        proofPhotoUrls,
        deliveryNote: String(formData.get("deliveryNote") || "").trim(),
        safePlaceNote: String(formData.get("safePlaceNote") || "").trim(),
        leftInSafePlace: String(formData.get("leftInSafePlace") || "") === "true",
      });

      return redirect(`/driver/routes/${token}#next-stop`);
    }

    if (intent === "missedStop") {
      const admin = await getOfflineShopifyAdmin();
      await markDriverStopMissedFromToken({
        token,
        stopId,
        admin,
        reason: String(formData.get("failedReason") || "").trim(),
        note: String(formData.get("failedNote") || "").trim(),
      });

      return redirect(`/driver/routes/${token}#next-stop`);
    }

    return redirect(`/driver/routes/${token}`);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Driver route action failed." }, { status: 400 });
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

function formatCollectedAt(value: string | Date | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
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
  const nextStop = route.stops.find((stop) => stop.status === "PENDING");
  const mapPoints = route.stops
    .filter((stop) => typeof stop.deliveryGroup?.latitude === "number" && typeof stop.deliveryGroup?.longitude === "number")
    .map((stop) => ({
      id: stop.id,
      label: String(stop.orderIndex),
      title: `Drop ${stop.orderIndex} · ${stop.deliveryGroup?.postcode || "No postcode"}`,
      latitude: stop.deliveryGroup?.latitude ?? null,
      longitude: stop.deliveryGroup?.longitude ?? null,
      selected: nextStop?.id === stop.id,
      status: stop.status,
    }));

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
          <RouteMap
            title="Driver route map"
            badge={`${mapPoints.length} pins`}
            points={mapPoints}
            height={340}
          />
        </section>

        <section style={{ background: "#ffffff", borderRadius: 18, padding: 14, boxShadow: "0 8px 24px rgba(50,56,65,0.08)", marginBottom: 14 }}>
          {actionData && "error" in actionData ? (
            <p style={{ margin: "0 0 10px", color: "#b42318", fontWeight: 700 }}>{actionData.error}</p>
          ) : null}
          {routeStarted ? (
            <p style={{ margin: 0, fontWeight: 700, color: "#16a34a" }}>Route started. Customer tracking can now become active.</p>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="startRoute" />
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
            const isFailed = stop.status === "FAILED";
            const isNextStop = nextStop?.id === stop.id;
            const actionDisabled = !routeStarted || isDelivered || isFailed;
            const returnTickets = stop.returnTickets || [];

            return (
              <article id={isNextStop ? "next-stop" : undefined} key={stop.id} style={{ background: isDelivered ? "#ecfdf3" : isFailed ? "#fef3f2" : "#ffffff", border: isDelivered ? "1px solid #86efac" : isFailed ? "1px solid #fecdca" : isNextStop ? "2px solid #509AE6" : "1px solid #e5e7eb", borderRadius: 18, padding: 16, boxShadow: "0 8px 24px rgba(50,56,65,0.08)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 20 }}>Drop {stop.orderIndex}{isNextStop ? " · Next" : ""}</h2>
                    <p style={{ margin: "6px 0 0", color: "#667085" }}>{formatSlot(stop.estimatedArrival)}</p>
                  </div>
                  <span style={{ background: isDelivered ? "#16a34a" : isFailed ? "#b42318" : "#eff6ff", color: isDelivered || isFailed ? "#ffffff" : "#509AE6", borderRadius: 999, padding: "6px 10px", fontSize: 13, fontWeight: 700 }}>{statusLabel(stop.status)}</span>
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

                {returnTickets.length ? (
                  <section style={{ marginTop: 14, display: "grid", gap: 12 }}>
                    <h3 style={{ margin: 0, fontSize: 18 }}>Returns to collect</h3>
                    {returnTickets.map((ticket) => {
                      const collected = ticket.status === "COLLECTED";

                      return (
                        <div key={ticket.id} style={{ border: collected ? "1px solid #86efac" : "1px solid #fedf89", background: collected ? "#ecfdf3" : "#fffaeb", borderRadius: 14, padding: 12 }}>
                          <p style={{ margin: 0, fontWeight: 700 }}>{ticket.reference} · {ticket.status.toLowerCase()}</p>
                          <p style={{ margin: "6px 0 0", color: "#667085" }}>{ticket.notes || "No return notes"}</p>
                          {collected ? (
                            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                              <p style={{ margin: 0 }}>Collected at {formatCollectedAt(ticket.collectedAt)}</p>
                              {ticket.customerSignature ? <p style={{ margin: 0 }}><strong>Signed/marked by:</strong> {ticket.customerSignature}</p> : null}
                              {ticket.collectionPhotoUrl ? <a href={ticket.collectionPhotoUrl} target="_blank" rel="noreferrer" style={{ color: "#509AE6", fontWeight: 700 }}>Open collection photo</a> : null}
                            </div>
                          ) : (
                            <Form method="post" encType="multipart/form-data" style={{ marginTop: 10, display: "grid", gap: 10 }}>
                              <input type="hidden" name="intent" value="collectReturnTicket" />
                              <input type="hidden" name="ticketId" value={ticket.id} />
                              {ticket.lines.map((line) => (
                                <label key={line.id} style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                                  {line.itemName} · expected {line.quantityExpected}
                                  <input name={`quantityCollected_${line.id}`} type="number" min="0" max={line.quantityExpected} defaultValue={line.quantityExpected} disabled={!routeStarted} style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 10 }} />
                                </label>
                              ))}
                              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                                Collection photo
                                <input type="file" name="collectionPhotoFile" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" disabled={!routeStarted} />
                              </label>
                              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                                Customer signature or mark
                                <input name="customerSignature" disabled={!routeStarted} placeholder="Customer name, signature mark, or not present" style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 10 }} />
                              </label>
                              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                                Driver return note
                                <textarea name="driverNote" rows={2} disabled={!routeStarted} style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 10 }} />
                              </label>
                              <button type="submit" disabled={!routeStarted} style={{ border: 0, borderRadius: 12, padding: "12px 10px", background: routeStarted ? "#509AE6" : "#d0d5dd", color: "#ffffff", fontWeight: 700 }}>Confirm return collected</button>
                            </Form>
                          )}
                        </div>
                      );
                    })}
                  </section>
                ) : null}

                {stop.deliveryGroup?.proofPhotos?.length ? (
                  <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8 }}>
                    {stop.deliveryGroup.proofPhotos.map((photo, index) => (
                      <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" style={{ display: "block", textDecoration: "none" }}>
                        <img src={photo.url} alt={photo.label || `Proof photo ${index + 1}`} style={{ width: "100%", height: 78, objectFit: "cover", borderRadius: 10, display: "block" }} />
                      </a>
                    ))}
                  </div>
                ) : null}

                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                  {wazeUrl ? <a href={wazeUrl} target="_blank" rel="noreferrer" style={{ textAlign: "center", borderRadius: 12, padding: "11px 10px", background: "#509AE6", color: "#ffffff", fontWeight: 700, textDecoration: "none" }}>Open map</a> : null}
                </div>

                {!isDelivered && !isFailed ? (
                  <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                    <Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: 10 }}>
                      <input type="hidden" name="intent" value="completeStop" />
                      <input type="hidden" name="stopId" value={stop.id} />
                      <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                        Add proof photos
                        <input type="file" name="proofPhotoFiles" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" multiple disabled={actionDisabled} />
                      </label>
                      <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                        Delivery note
                        <textarea name="deliveryNote" rows={2} disabled={actionDisabled} style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 10 }} />
                      </label>
                      <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                        Safe place note
                        <textarea name="safePlaceNote" rows={2} disabled={actionDisabled} style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 10 }} />
                      </label>
                      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="checkbox" name="leftInSafePlace" value="true" disabled={actionDisabled} />
                        Left in safe place
                      </label>
                      <button type="submit" disabled={actionDisabled} style={{ border: 0, borderRadius: 12, padding: "12px 10px", background: actionDisabled ? "#d0d5dd" : "#16a34a", color: "#ffffff", fontWeight: 700 }}>Complete delivery</button>
                    </Form>

                    <Form method="post" style={{ display: "grid", gap: 10 }}>
                      <input type="hidden" name="intent" value="missedStop" />
                      <input type="hidden" name="stopId" value={stop.id} />
                      <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                        Missed delivery reason
                        <input name="failedReason" disabled={actionDisabled} placeholder="No answer, access issue, customer unavailable" style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 10 }} />
                      </label>
                      <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                        Missed delivery note
                        <textarea name="failedNote" rows={2} disabled={actionDisabled} style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 10 }} />
                      </label>
                      <button type="submit" disabled={actionDisabled} style={{ border: 0, borderRadius: 12, padding: "12px 10px", background: actionDisabled ? "#d0d5dd" : "#b42318", color: "#ffffff", fontWeight: 700 }}>Mark missed delivery</button>
                    </Form>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}
