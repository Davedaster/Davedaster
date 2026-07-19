import fs from "node:fs";

const path = "app/routes/app._index.tsx";
let source = fs.readFileSync(path, "utf8");

const featureFlag = "const MANUAL_ORDER_CREATION_ENABLED = false;";
const logoConstant = `const RAPID_DELIVERY_LOGO_URL = "https://cdn.shopify.com/s/files/1/0873/6250/2974/files/Rapid_Delivery.png?v=1782326829";`;

if (!source.includes(featureFlag)) {
  if (!source.includes(logoConstant)) {
    throw new Error("Could not safely locate the planning-map constants before hiding manual-order controls.");
  }

  source = source.replace(logoConstant, `${logoConstant}\nconst MANUAL_ORDER_CREATION_ENABLED = false;`);
}

source = source.replace(
  "Address lookup credentials are not set up. Add them in Settings before testing new manual or custom addresses.",
  "Address lookup credentials are not set up. Add them in Settings before using custom addresses.",
);

const heading = `<Text as="h3" variant="headingSm">Add manual order</Text>`;
const blockStartMarker = `            <Box padding="300" borderBlockEndWidth="025" borderColor="border">`;
const blockEndMarker = `            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>`;
const headingIndex = source.indexOf(heading);

if (headingIndex === -1) {
  throw new Error("Could not safely locate the manual-order controls in the planning map.");
}

const blockStart = source.lastIndexOf(blockStartMarker, headingIndex);
const blockEnd = source.indexOf(blockEndMarker, headingIndex);

if (blockStart === -1 || blockEnd === -1 || blockEnd <= blockStart) {
  throw new Error("Could not safely identify the manual-order control section boundaries.");
}

const precedingSource = source.slice(Math.max(0, blockStart - 120), blockStart);

if (!precedingSource.includes("{MANUAL_ORDER_CREATION_ENABLED ? (")) {
  const manualOrderSection = source.slice(blockStart, blockEnd).trimEnd();
  const hiddenSection = `            {MANUAL_ORDER_CREATION_ENABLED ? (\n${manualOrderSection}\n            ) : null}\n\n`;
  source = `${source.slice(0, blockStart)}${hiddenSection}${source.slice(blockEnd)}`;
}

fs.writeFileSync(path, source);
console.log("Manual-order creation controls hidden from new and draft route planning screens.");
