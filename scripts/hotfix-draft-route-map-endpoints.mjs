import { readFileSync, writeFileSync } from "node:fs";

const routeDetailsPath = "app/routes/app.routes.$routeId.tsx";

function replaceOnce(source, label, from, to) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Could not apply draft route endpoint hotfix: ${label}`);
  return source.replace(from, to);
}

let source = readFileSync(routeDetailsPath, "utf8");

source = replaceOnce(
  source,
  "import route map",
  `import { useState } from "react";

import { getAppCredentials, hasRouteXLCredentials } from "../lib/appCredentials.server";`,
  `import { useState } from "react";

import { RouteMap } from "../components/RouteMap";
import { getAppCredentials, hasRouteXLCredentials } from "../lib/appCredentials.server";`,
);

source = replaceOnce(
  source,
  "return tomtom key from loader",
  `  return json({ route, drivers, routexlEnabled: hasRouteXLCredentials(credentials), availableDraftOrders });`,
  `  return json({ route, drivers, routexlEnabled: hasRouteXLCredentials(credentials), tomtomApiKey: credentials.tomtomApiKey, availableDraftOrders });`,
);

source = replaceOnce(
  source,
  "add coordinate parser",
  `function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function fulfilmentPublishLabel`,
  `function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function formCoordinate(formData: FormData, name: string) {
  const rawValue = String(formData.get(name) || "").trim();

  if (!rawValue) {
    return null;
  }

  const value = Number(rawValue);

  return Number.isFinite(value) ? value : null;
}

function fulfilmentPublishLabel`,
);

source = replaceOnce(
  source,
  "save endpoint coordinates",
  `        startAddress: String(formData.get("startAddress") || "").trim(),
        finishAddress: String(formData.get("finishAddress") || "").trim(),
      });`,
  `        startAddress: String(formData.get("startAddress") || "").trim(),
        finishAddress: String(formData.get("finishAddress") || "").trim(),
        startLatitude: formCoordinate(formData, "startLatitude"),
        startLongitude: formCoordinate(formData, "startLongitude"),
        finishLatitude: formCoordinate(formData, "finishLatitude"),
        finishLongitude: formCoordinate(formData, "finishLongitude"),
      });`,
);

source = replaceOnce(
  source,
  "destructure tomtom key",
  `  const { route, drivers, routexlEnabled, availableDraftOrders } = useLoaderData<typeof loader>();`,
  `  const { route, drivers, routexlEnabled, tomtomApiKey, availableDraftOrders } = useLoaderData<typeof loader>();`,
);

source = replaceOnce(
  source,
  "add endpoint coordinate state",
  `  const [startAddress, setStartAddress] = useState(route.startAddress || "Bathroom Panels Direct");
  const [finishAddress, setFinishAddress] = useState(route.finishAddress || "Bathroom Panels Direct");`,
  `  const [startAddress, setStartAddress] = useState(route.startAddress || "Bathroom Panels Direct");
  const [finishAddress, setFinishAddress] = useState(route.finishAddress || "Bathroom Panels Direct");
  const [startLatitude, setStartLatitude] = useState(route.startLatitude === null || typeof route.startLatitude === "undefined" ? "" : String(route.startLatitude));
  const [startLongitude, setStartLongitude] = useState(route.startLongitude === null || typeof route.startLongitude === "undefined" ? "" : String(route.startLongitude));
  const [finishLatitude, setFinishLatitude] = useState(route.finishLatitude === null || typeof route.finishLatitude === "undefined" ? "" : String(route.finishLatitude));
  const [finishLongitude, setFinishLongitude] = useState(route.finishLongitude === null || typeof route.finishLongitude === "undefined" ? "" : String(route.finishLongitude));`,
);

source = replaceOnce(
  source,
  "add map point handler before driver options",
  `  const driverOptions = [{ label: "No driver assigned", value: "" }, ...drivers.map((driver) => ({ label: driver.name, value: driver.id }))];`,
  `  const draftRouteMapPoints = route.stops.flatMap((stop) => {
    const latitude = stop.deliveryGroup?.latitude;
    const longitude = stop.deliveryGroup?.longitude;

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return [];
    }

    const orderNumbers = stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "Stop";
    const customerNames = stop.deliveryGroup?.orders.map((order) => order.customerName).filter(Boolean).join(", ") || "Customer";
    const postcode = stop.deliveryGroup?.postcode || "No postcode";
    const heading = ` + "`${stop.orderIndex}. ${orderNumbers} · ${customerNames}`" + `;

    return [{
      id: stop.id,
      label: String(stop.orderIndex),
      title: ` + "`${heading} · ${postcode}`" + `,
      latitude,
      longitude,
      selected: true,
      status: stop.status,
      tooltipTitle: heading,
      tooltipLines: [
        ` + "`Postcode: ${postcode}`" + `,
        ` + "`ETA slot: ${formatSlot(stop.estimatedArrival, route.customerSlotMinutes || 60)}`" + `,
        ` + "`Status: ${stop.status}`" + `,
      ],
    }];
  });

  const handleDraftRouteEndpoint = (endpoint: { status: "START" | "FINISH"; address: string; latitude: number; longitude: number }) => {
    if (endpoint.status === "START") {
      setStartAddress(endpoint.address);
      setStartLatitude(String(endpoint.latitude));
      setStartLongitude(String(endpoint.longitude));
    } else {
      setFinishAddress(endpoint.address);
      setFinishLatitude(String(endpoint.latitude));
      setFinishLongitude(String(endpoint.longitude));
    }
  };

  const driverOptions = [{ label: "No driver assigned", value: "" }, ...drivers.map((driver) => ({ label: driver.name, value: driver.id }))];`,
);

source = replaceOnce(
  source,
  "add draft route map to planning card",
  `              <Text as="h2" variant="headingMd">Route planning</Text>
              <Text as="p" variant="bodySm" tone="subdued">Set the delivery date, start time and slot length before sending customers their booked delivery slot.</Text>
              <Form method="post">`,
  `              <Text as="h2" variant="headingMd">Route planning</Text>
              <Text as="p" variant="bodySm" tone="subdued">Set the delivery date, start time and slot length before sending customers their booked delivery slot.</Text>
              {route.status === "DRAFT" && tomtomApiKey ? (
                <RouteMap
                  title="Draft route map"
                  badge="Right click to set start or end"
                  height={360}
                  apiKey={tomtomApiKey}
                  points={draftRouteMapPoints}
                  showRouteLine={draftRouteMapPoints.length > 0}
                  routeStart={{ address: startAddress, label: "START", latitude: startLatitude ? Number(startLatitude) : null, longitude: startLongitude ? Number(startLongitude) : null, status: "START" }}
                  routeFinish={{ address: finishAddress || startAddress, label: "FINISH", latitude: finishLatitude ? Number(finishLatitude) : null, longitude: finishLongitude ? Number(finishLongitude) : null, status: "FINISH" }}
                  onSetRouteEndpoint={handleDraftRouteEndpoint}
                />
              ) : null}
              <Form method="post">`,
);

source = replaceOnce(
  source,
  "add coordinate hidden inputs and clear stale coordinates on manual edits",
  `                  <TextField label="Customer delivery slot minutes" name="customerSlotMinutes" type="number" min={15} value={customerSlotMinutes} onChange={setCustomerSlotMinutes} autoComplete="off" helpText="Example: 60 gives the customer a one hour ETA window." />
                  <TextField label="Route start address" name="startAddress" value={startAddress} onChange={setStartAddress} autoComplete="off" />
                  <TextField label="Route finish address" name="finishAddress" value={finishAddress} onChange={setFinishAddress} autoComplete="off" />
                  <Button submit>Save route planning</Button>`,
  `                  <TextField label="Customer delivery slot minutes" name="customerSlotMinutes" type="number" min={15} value={customerSlotMinutes} onChange={setCustomerSlotMinutes} autoComplete="off" helpText="Example: 60 gives the customer a one hour ETA window." />
                  <input type="hidden" name="startLatitude" value={startLatitude} />
                  <input type="hidden" name="startLongitude" value={startLongitude} />
                  <input type="hidden" name="finishLatitude" value={finishLatitude} />
                  <input type="hidden" name="finishLongitude" value={finishLongitude} />
                  <TextField label="Route start address" name="startAddress" value={startAddress} onChange={(value) => { setStartAddress(value); setStartLatitude(""); setStartLongitude(""); }} autoComplete="off" helpText={startLatitude && startLongitude ? "Set from the map. Save route planning to keep this start point." : undefined} />
                  <TextField label="Route finish address" name="finishAddress" value={finishAddress} onChange={(value) => { setFinishAddress(value); setFinishLatitude(""); setFinishLongitude(""); }} autoComplete="off" helpText={finishLatitude && finishLongitude ? "Set from the map. Save route planning to keep this end point." : undefined} />
                  <Button submit>Save route planning</Button>`,
);

writeFileSync(routeDetailsPath, source);
console.log("Draft route map endpoint hotfix applied.");
