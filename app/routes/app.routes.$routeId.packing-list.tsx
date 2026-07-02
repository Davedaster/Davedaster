import type { LoaderFunctionArgs } from "@remix-run/node";

import { formatEtaSlot } from "../lib/etaSlots";
import { getRoute } from "../lib/routeDrafts.server";

type PdfLine = {
  text: string;
  size?: number;
  bold?: boolean;
  gap?: number;
  checkbox?: boolean;
  rule?: boolean;
  x?: number;
};

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const routeId = params.routeId;

  if (!routeId) throw new Response("Route not found", { status: 404 });

  const route = await getRoute(routeId);

  if (!route) throw new Response("Route not found", { status: 404 });

  const safeRouteName = String(route.name || "route")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "route";

  return new Response(createWarehousePackingPdf(route, new Date().toISOString()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeRouteName}-warehouse-packing-list.pdf"`,
      "Cache-Control": "no-store",
    },
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

function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function formatSlot(value: string | Date | null, slotMinutes = 60) {
  if (!value) return "ETA pending";
  const start = new Date(value);
  const end = new Date(start.getTime() + slotMinutes * 60 * 1000);
  return formatEtaSlot(start, end);
}

function splitLineItems(summary?: string | null) {
  return (summary || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parseItem(item: string) {
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
  const itemMap = new Map<string, { label: string; quantity: number }>();

  for (const item of lineItems) {
    const parsed = parseItem(item);
    const quantity = Number.isFinite(parsed.quantity) ? parsed.quantity : 1;
    const existing = itemMap.get(itemKey(item));

    if (existing) existing.quantity += quantity;
    else itemMap.set(itemKey(item), { label: parsed.label, quantity });
  }

  return Array.from(itemMap.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function addWrappedLine(lines: PdfLine[], text: string, options: PdfLine = {}, maxLength = 86) {
  const words = text.split(/\s+/).filter(Boolean);
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length > maxLength && current) {
      lines.push({ ...options, text: current });
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push({ ...options, text: current });
}

function section(lines: PdfLine[], title: string) {
  lines.push({ text: "", gap: 10 });
  lines.push({ text: title.toUpperCase(), size: 13, bold: true, gap: 6 });
  lines.push({ text: "", rule: true, gap: 8 });
}

function checkbox(lines: PdfLine[], text: string, options: PdfLine = {}) {
  addWrappedLine(lines, text, { ...options, checkbox: true }, 78);
}

function createWarehousePackingPdf(route: any, generatedAt: string) {
  const stops = route.stops || [];
  const itemMap = new Map<string, { label: string; quantity: number; stops: number[] }>();

  for (const stop of stops) {
    for (const order of stop.deliveryGroup?.orders || []) {
      for (const item of splitLineItems(order.lineItemSummary)) {
        const parsed = parseItem(item);
        const quantity = Number.isFinite(parsed.quantity) ? parsed.quantity : 1;
        const key = itemKey(item);
        const existing = itemMap.get(key);

        if (existing) {
          existing.quantity += quantity;
          existing.stops.push(stop.orderIndex);
        } else {
          itemMap.set(key, { label: parsed.label, quantity, stops: [stop.orderIndex] });
        }
      }
    }
  }

  const driver = route.driver;
  const registration = driver?.vehicleRegistration || "Registration not set";
  const vehicleName = driver?.vehicleName || "Vehicle not set";
  const totalOrders = stops.reduce((count: number, stop: any) => count + (stop.deliveryGroup?.orders.length || 0), 0);
  const getLoadPosition = (dropNumber: number) => Math.max(1, stops.length - dropNumber + 1);
  const items = Array.from(itemMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  const loadOrder = [...stops].sort((a, b) => b.orderIndex - a.orderIndex);
  const lines: PdfLine[] = [];

  lines.push({ text: "BATHROOM PANELS DIRECT", size: 11, bold: true, gap: 14 });
  lines.push({ text: "WAREHOUSE PACKING LIST", size: 24, bold: true, gap: 16 });
  lines.push({ text: `${route.name} | ${formatDate(route.date)}`, size: 14, bold: true, gap: 8 });
  lines.push({ text: `Status: ${route.status === "DRAFT" ? "DRAFT ROUTE - CHECK BEFORE LOADING" : `${route.status} ROUTE`}`, size: 11, bold: true, gap: 10 });

  section(lines, "Route and van summary");
  lines.push({ text: `Van registration: ${registration}`, size: 16, bold: true, gap: 8 });
  lines.push({ text: `Vehicle: ${vehicleName}` });
  lines.push({ text: `Driver: ${driver?.name || "No driver assigned"}` });
  lines.push({ text: `Driver phone: ${driver?.phoneNumber || "Not set"}` });
  lines.push({ text: `Total drops: ${stops.length}    Total orders: ${totalOrders}` });
  lines.push({ text: `Start: ${route.startAddress || "Bathroom Panels Direct"}` });
  lines.push({ text: `Finish: ${route.finishAddress || "Bathroom Panels Direct"}` });
  lines.push({ text: `Planned start: ${route.plannedStartTime || "05:00"}` });
  lines.push({ text: `Generated: ${formatDateTime(generatedAt)}` });

  section(lines, "Master pick list - total items for the van");
  if (items.length) {
    for (const item of items) {
      const drops = Array.from(new Set(item.stops)).sort((a, b) => a - b).join(", ");
      checkbox(lines, `Qty ${item.quantity}  ${item.label}  | Drops: ${drops}`, { bold: true });
    }
  } else {
    lines.push({ text: "No item details are stored against this route yet." });
  }

  lines.push({ text: "", gap: 8 });
  addWrappedLine(lines, "Loading rule: load by Load Position. Position 1 goes onto the van first. Drop 1 stays nearest the rear doors.", { bold: true }, 88);

  section(lines, "Final warehouse checks");
  checkbox(lines, "Panels loaded");
  checkbox(lines, "Trims loaded");
  checkbox(lines, "Adhesives loaded");
  checkbox(lines, "Silicone loaded");
  checkbox(lines, "Route checked");
  checkbox(lines, "Paperwork issued");
  lines.push({ text: "Picked by: ____________________    Checked by: ____________________    Time: __________", gap: 8 });

  section(lines, "Loading order");
  lines.push({ text: "Follow Load Position from top to bottom. Drop cards are listed in route order.", bold: true });
  for (const stop of loadOrder) {
    const orders = stop.deliveryGroup?.orders || [];
    const orderNumbers = orders.map((order: any) => order.shopifyOrderNumber).join(", ") || "No orders";
    const customerNames = orders.map((order: any) => order.customerName).filter(Boolean).join(", ") || "No customer";
    const postcode = stop.deliveryGroup?.postcode || "No postcode";
    checkbox(lines, `Load Position ${getLoadPosition(stop.orderIndex)} | Drop ${stop.orderIndex} | ${orderNumbers} | ${customerNames} | ${postcode}`);
  }

  section(lines, "Drop cards");
  for (const stop of [...stops].sort((a, b) => a.orderIndex - b.orderIndex)) {
    const group = stop.deliveryGroup;
    const orders = group?.orders || [];
    const customerNames = orders.map((order: any) => order.customerName).filter(Boolean).join(", ") || "Customer name missing";
    const orderNumbers = orders.map((order: any) => order.shopifyOrderNumber).join(", ") || "No linked orders";
    const address = group?.formattedAddress || group?.address || "No address";
    const lineItems = combineLineItems(orders.flatMap((order: any) => splitLineItems(order.lineItemSummary)));
    const itemTotal = lineItems.reduce((total, item) => total + item.quantity, 0);
    const notes = [group?.deliveryNote, group?.safePlaceNote].filter(Boolean).join(" | ");

    lines.push({ text: "", gap: 12 });
    lines.push({ text: `DROP ${stop.orderIndex}    LOAD POSITION ${getLoadPosition(stop.orderIndex)}`, size: 15, bold: true, gap: 8 });
    addWrappedLine(lines, `Customer: ${customerNames}`, { bold: true });
    addWrappedLine(lines, `Order: ${orderNumbers}`);
    addWrappedLine(lines, `Address: ${address}`);
    lines.push({ text: `Postcode: ${group?.postcode || "No postcode"}    ETA: ${formatSlot(stop.estimatedArrival, route.customerSlotMinutes || 60)}    Van: ${registration}` });
    lines.push({ text: "Items for this drop:", bold: true });

    if (lineItems.length) {
      for (const item of lineItems) checkbox(lines, `Qty ${item.quantity}  ${item.label}`, { bold: true });
    } else {
      lines.push({ text: "No item details stored for this stop." });
    }

    lines.push({ text: `Total items for drop: ${itemTotal || "Not stored"}`, bold: true });
    addWrappedLine(lines, `Notes: ${notes || ""}`);
    checkbox(lines, "Picked");
    checkbox(lines, "Loaded");
    lines.push({ text: "Checked by: ____________________" });
  }

  lines.push({ text: "", gap: 8 });
  lines.push({ text: `Route: ${route.name} | Van: ${registration} | Orders: ${totalOrders}`, size: 8 });

  return buildPdf(lines);
}

function pdfText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[–—]/g, "-")
    .replace(/[·•]/g, "|");
}

function buildPdf(lines: PdfLine[]) {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginX = 42;
  const topY = 790;
  const bottomY = 42;
  const pages: string[][] = [];
  let currentPage: string[] = [];
  let y = topY;

  function newPage() {
    if (currentPage.length) pages.push(currentPage);
    currentPage = [];
    y = topY;
  }

  for (const line of lines) {
    const size = line.size || 10;
    const lineHeight = size + (line.gap ?? 5);
    if (y - lineHeight < bottomY) newPage();

    if (line.rule) {
      currentPage.push(`${marginX} ${y + 5} m ${pageWidth - marginX} ${y + 5} l S`);
    } else if (line.text) {
      const font = line.bold ? "F2" : "F1";
      const x = line.x || marginX;
      const textX = line.checkbox ? x + 18 : x;
      if (line.checkbox) currentPage.push(`${x} ${y - 2} 10 10 re S`);
      currentPage.push(`BT /${font} ${size} Tf ${textX} ${y} Td (${pdfText(line.text)}) Tj ET`);
    }

    y -= lineHeight;
  }

  newPage();

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  const pageObjectNumbers: number[] = [];

  for (const pageCommands of pages) {
    const content = pageCommands.join("\n");
    const pageObjectNumber = objects.length + 1;
    const contentObjectNumber = objects.length + 2;
    pageObjectNumbers.push(pageObjectNumber);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  }

  objects[1] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageObjectNumbers.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}
