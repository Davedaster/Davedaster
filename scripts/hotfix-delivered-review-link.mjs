import { readFileSync, writeFileSync } from "node:fs";

const files = {
  templates: "app/lib/notificationTemplates.server.ts",
  senders: "app/lib/notificationSenders.server.ts",
  completion: "app/lib/deliveryCompleteNotifications.server.ts",
  failed: "app/lib/failedDelivery.server.ts",
  driver: "app/lib/driverRouteAccess.server.ts",
  notificationsRoute: "app/routes/app.notifications.tsx",
};

const source = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, readFileSync(path, "utf8")]));

function replaceOnce(fileKey, label, from, to) {
  const current = source[fileKey];

  if (current.includes(to)) {
    return;
  }

  if (!current.includes(from)) {
    throw new Error(`Could not apply one-segment SMS hotfix: ${label}`);
  }

  source[fileKey] = current.replace(from, to);
}

replaceOnce(
  "templates",
  "import SMS formatter",
  `import { formatEtaSlot } from "./etaSlots.server";`,
  `import { formatEtaSlot } from "./etaSlots.server";\nimport { formatSmsBody } from "./smsFormatting";`,
);

replaceOnce(
  "templates",
  "bump SMS template version",
  `const SMS_TEMPLATE_VERSION = "customer_sms_filter_safe_2026_07_09";`,
  `const SMS_TEMPLATE_VERSION = "one_segment_sms_2026_07_19";`,
);

replaceOnce(
  "templates",
  "short safe-place delivery SMS",
  `const safePlaceDeliveryCompleteSmsBody = \`Bathroom Panels Direct: Your delivery for order {{ order.number }} has been completed and left safely at the property. View delivery details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.\`;`,
  `const safePlaceDeliveryCompleteSmsBody = \`Bathroom Panels Direct\n{{ order.number }} left in your safe place\nProof: {{ tracking.url }}\nHelp: {{ company.phone }}\nReply STOP to opt out.\`;`,
);

const templateReplacements = [
  [
    "short booked delivery SMS",
    `smsBody: "Bathroom Panels Direct: Your delivery for order {{ order.number }} is planned for {{ delivery.date }}, {{ delivery.eta_slot }}. View delivery details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",`,
    `smsBody: "Bathroom Panels Direct\\n{{ order.number }} booked: {{ delivery.sms_date }}, {{ delivery.sms_eta_slot }}\\nTrack: {{ tracking.url }}\\nHelp: {{ company.phone }}\\nReply STOP to opt out.",`,
  ],
  [
    "short out-for-delivery SMS",
    `smsBody: "Bathroom Panels Direct: Your order {{ order.number }} is out for delivery today. {% if driver.name %}Your driver is {{ driver.name }}. {% endif %}Delivery window: {{ delivery.eta_slot }}. View delivery details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",`,
    `smsBody: "Bathroom Panels Direct\\n{{ order.number }} out for delivery\\nETA: {{ delivery.sms_eta_slot }}\\nTrack: {{ tracking.url }}\\nHelp: {{ company.phone }}\\nReply STOP to opt out.",`,
  ],
  [
    "short next-delivery SMS",
    `smsBody: "Bathroom Panels Direct: You are the next delivery stop for order {{ order.number }}. Please keep access clear. View delivery details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",`,
    `smsBody: "Bathroom Panels Direct\\n{{ order.number }} is next\\nKeep access clear\\nTrack: {{ tracking.url }}\\nHelp: {{ company.phone }}\\nReply STOP to opt out.",`,
  ],
  [
    "short delivery delay SMS",
    `smsBody: "Bathroom Panels Direct: Your delivery for order {{ order.number }} is running about {{ delay.minutes }} minutes later than planned. Updated window: {{ delivery.eta_slot }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",`,
    `smsBody: "Bathroom Panels Direct\\n{{ order.number }} delayed about {{ delay.minutes }} mins\\nNew ETA: {{ delivery.sms_eta_slot }}\\nHelp: {{ company.phone }}\\nReply STOP to opt out.",`,
  ],
  [
    "short delivered review SMS",
    `smsBody: "{% if delivery.left_in_safe_place %}" + safePlaceDeliveryCompleteSmsBody + \`{% else %}Bathroom Panels Direct: Your delivery for order {{ order.number }} has been completed. Thank you for your order. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.{% endif %}\`,`,
    `smsBody: "{% if delivery.left_in_safe_place %}" + safePlaceDeliveryCompleteSmsBody + \`{% else %}Bathroom Panels Direct\n{{ order.number }} delivered\nPlease support our family business by leaving us a review:\nhttps://review-bpd.s.gy/hHKdYF\nReply STOP to opt out.{% endif %}\`,`,
  ],
  [
    "short booked return SMS",
    `smsBody: "Bathroom Panels Direct: Your return for order {{ order.number }} is planned for {{ delivery.date }}, {{ delivery.eta_slot }}. View return details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",`,
    `smsBody: "Bathroom Panels Direct\\n{{ order.number }} return: {{ delivery.sms_date }}, {{ delivery.sms_eta_slot }}\\nTrack: {{ tracking.url }}\\nHelp: {{ company.phone }}\\nReply STOP to opt out.",`,
  ],
  [
    "short collection-today SMS",
    `smsBody: "Bathroom Panels Direct: Your return for order {{ order.number }} is scheduled for today. {% if driver.name %}Your driver is {{ driver.name }}. {% endif %}Return window: {{ delivery.eta_slot }}. View return details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",`,
    `smsBody: "Bathroom Panels Direct\\n{{ order.number }} collection today\\nETA: {{ delivery.sms_eta_slot }}\\nTrack: {{ tracking.url }}\\nHelp: {{ company.phone }}\\nReply STOP to opt out.",`,
  ],
  [
    "short next-collection SMS",
    `smsBody: "Bathroom Panels Direct: You are the next return stop for order {{ order.number }}. Please keep access clear. View return details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",`,
    `smsBody: "Bathroom Panels Direct\\n{{ order.number }} collection next\\nKeep access clear\\nTrack: {{ tracking.url }}\\nHelp: {{ company.phone }}\\nReply STOP to opt out.",`,
  ],
  [
    "short collection delay SMS",
    `smsBody: "Bathroom Panels Direct: Your return for order {{ order.number }} is running about {{ delay.minutes }} minutes later than planned. Updated window: {{ delivery.eta_slot }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",`,
    `smsBody: "Bathroom Panels Direct\\n{{ order.number }} collection delayed {{ delay.minutes }} mins\\nNew ETA: {{ delivery.sms_eta_slot }}\\nHelp: {{ company.phone }}\\nReply STOP to opt out.",`,
  ],
  [
    "short collection complete SMS",
    `smsBody: "Bathroom Panels Direct: Your return for order {{ order.number }} has been completed. We will check the returned items before confirming the next step. View return details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",`,
    `smsBody: "Bathroom Panels Direct\\n{{ order.number }} return collected\\nItems will be checked\\nDetails: {{ tracking.url }}\\nHelp: {{ company.phone }}\\nReply STOP to opt out.",`,
  ],
];

for (const [label, from, to] of templateReplacements) {
  replaceOnce("templates", label, from, to);
}

replaceOnce(
  "templates",
  "add compact SMS date and slot formatters",
  `function formatTime(value?: Date | string | null) {\n  if (!value) return "";\n  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(value));\n}\n\nfunction formatSlot(estimatedArrival?: Date | string | null, slotMinutes = 60, serviceType: NotificationServiceType = "delivery") {`,
  `function formatTime(value?: Date | string | null) {\n  if (!value) return "";\n  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(value));\n}\n\nfunction formatSmsDate(value?: Date | string | null, serviceType: NotificationServiceType = "delivery") {\n  if (!value) return serviceType === "collection" ? "return day" : "delivery day";\n  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(value));\n}\n\nfunction formatSmsSlot(estimatedArrival?: Date | string | null, slotMinutes = 60, serviceType: NotificationServiceType = "delivery") {\n  if (!estimatedArrival) return serviceType === "collection" ? "return slot TBC" : "delivery slot TBC";\n  const start = new Date(estimatedArrival);\n  const end = new Date(start.getTime() + slotMinutes * 60 * 1000);\n  return \`\${formatTime(start)}-\${formatTime(end)}\`;\n}\n\nfunction formatSlot(estimatedArrival?: Date | string | null, slotMinutes = 60, serviceType: NotificationServiceType = "delivery") {`,
);

replaceOnce(
  "templates",
  "add compact SMS context values",
  `delivery: { date: formatDate(input.deliveryDate, serviceType), eta_start: formatTime(start), eta_end: formatTime(end), eta_slot: formatSlot(input.estimatedArrival, slotMinutes, serviceType), left_in_safe_place: Boolean(input.leftInSafePlace) },\n    collection: { date: formatDate(input.deliveryDate, "collection"), eta_start: formatTime(start), eta_end: formatTime(end), eta_slot: formatSlot(input.estimatedArrival, slotMinutes, "collection") },`,
  `delivery: { date: formatDate(input.deliveryDate, serviceType), eta_start: formatTime(start), eta_end: formatTime(end), eta_slot: formatSlot(input.estimatedArrival, slotMinutes, serviceType), sms_date: formatSmsDate(input.deliveryDate, serviceType), sms_eta_slot: formatSmsSlot(input.estimatedArrival, slotMinutes, serviceType), left_in_safe_place: Boolean(input.leftInSafePlace) },\n    collection: { date: formatDate(input.deliveryDate, "collection"), eta_start: formatTime(start), eta_end: formatTime(end), eta_slot: formatSlot(input.estimatedArrival, slotMinutes, "collection"), sms_date: formatSmsDate(input.deliveryDate, "collection"), sms_eta_slot: formatSmsSlot(input.estimatedArrival, slotMinutes, "collection") },`,
);

replaceOnce(
  "templates",
  "format rendered SMS",
  `  const body = renderLiquid(selectedTemplate.smsBody, context, "text");\n  if (channel === "sms" || !notificationTemplateSupportsEmail(selectedTemplate.id)) return { body };`,
  `  const body = renderLiquid(selectedTemplate.smsBody, context, "text");\n  const smsBody = formatSmsBody(body);\n  if (channel === "sms" || !notificationTemplateSupportsEmail(selectedTemplate.id)) return { body: smsBody };`,
);

replaceOnce(
  "templates",
  "format safe-place SMS",
  `    body: renderLiquid(safePlaceDeliveryCompleteSmsBody, buildTemplateContext({ ...input, leftInSafePlace: true }, trackingSettings), "text"),`,
  `    body: formatSmsBody(renderLiquid(safePlaceDeliveryCompleteSmsBody, buildTemplateContext({ ...input, leftInSafePlace: true }, trackingSettings), "text")),`,
);

replaceOnce(
  "templates",
  "expose compact SMS variables",
  `"{{ service.tracking_label }}", "{{ delivery.date }}", "{{ delivery.eta_start }}", "{{ delivery.eta_end }}", "{{ delivery.eta_slot }}", "{{ delivery.left_in_safe_place }}", "{{ collection.date }}", "{{ collection.eta_start }}", "{{ collection.eta_end }}", "{{ collection.eta_slot }}",`,
  `"{{ service.tracking_label }}", "{{ delivery.date }}", "{{ delivery.eta_start }}", "{{ delivery.eta_end }}", "{{ delivery.eta_slot }}", "{{ delivery.sms_date }}", "{{ delivery.sms_eta_slot }}", "{{ delivery.left_in_safe_place }}", "{{ collection.date }}", "{{ collection.eta_start }}", "{{ collection.eta_end }}", "{{ collection.eta_slot }}", "{{ collection.sms_date }}", "{{ collection.sms_eta_slot }}",`,
);

replaceOnce(
  "senders",
  "import SMS formatter",
  `import type { NotificationMessage } from "./notificationTemplates.server";`,
  `import type { NotificationMessage } from "./notificationTemplates.server";\nimport { formatSmsBody } from "./smsFormatting";`,
);

replaceOnce(
  "senders",
  "short help text",
  `const SMS_HELP_TEXT = "Need help? Call 01803 222784";`,
  `const SMS_HELP_TEXT = "Help: 01803 222784";`,
);

replaceOnce(
  "senders",
  "short opt-out text",
  `const SMS_OPT_OUT_TEXT = "Reply STOP to unsubscribe.";`,
  `const SMS_OPT_OUT_TEXT = "Reply STOP to opt out.";`,
);

replaceOnce(
  "senders",
  "recognise configurable help text",
  `  if (!compliantBody.toLowerCase().includes(SMS_HELP_TEXT.toLowerCase())) {`,
  `  if (!/(?:^|\\s)(?:help:|need help\\? call)\\s*/i.test(compliantBody)) {`,
);

replaceOnce(
  "senders",
  "format all outgoing SMS",
  `  const messageBody = input.includeHelpText === false\n    ? (input.message.body || "").trim()\n    : withSmsHelpText(input.message.body);`,
  `  const messageBody = formatSmsBody(input.includeHelpText === false\n    ? (input.message.body || "").trim()\n    : withSmsHelpText(input.message.body));`,
);

replaceOnce(
  "completion",
  "avoid adding help text to review SMS",
  `          message: input.leftInSafePlace\n            ? await buildSafePlaceDeliveryCompleteSms(baseMessageInput)\n            : await buildDeliveryCompleteMessage(baseMessageInput, "sms"),\n        });`,
  `          message: input.leftInSafePlace\n            ? await buildSafePlaceDeliveryCompleteSms(baseMessageInput)\n            : await buildDeliveryCompleteMessage(baseMessageInput, "sms"),\n          includeHelpText: input.leftInSafePlace ? undefined : false,\n        });`,
);

replaceOnce(
  "failed",
  "short failed-delivery SMS",
  `    body: \`Hi \${displayName(input.customerName)}, we attempted your Bathroom Panels Direct delivery for \${input.orderNumber} but could not complete it. Reason: \${input.reason}. View the update here: \${input.trackingUrl}\`,`,
  `    body: \`Bathroom Panels Direct\\n\${input.orderNumber} not delivered\\nReason/details: \${input.trackingUrl}\\nHelp: 01803 222784\\nReply STOP to opt out.\`,`,
);

replaceOnce(
  "driver",
  "add compact driver SMS date",
  `function formatDate(value: Date | string) {\n  return new Intl.DateTimeFormat("en-GB", {\n    weekday: "long",\n    day: "2-digit",\n    month: "long",\n    year: "numeric",\n    timeZone: "Europe/London",\n  }).format(new Date(value));\n}`,
  `function formatDate(value: Date | string) {\n  return new Intl.DateTimeFormat("en-GB", {\n    weekday: "long",\n    day: "2-digit",\n    month: "long",\n    year: "numeric",\n    timeZone: "Europe/London",\n  }).format(new Date(value));\n}\n\nfunction formatDriverSmsDate(value: Date | string) {\n  return new Intl.DateTimeFormat("en-GB", {\n    weekday: "short",\n    day: "numeric",\n    month: "short",\n    timeZone: "Europe/London",\n  }).format(new Date(value));\n}`,
);

replaceOnce(
  "driver",
  "short driver route SMS",
  `  const smsBody = \`Bathroom Panels Direct: Driver route \${route.name} is ready for \${formatDate(route.date)}. Start \${formatTime(route.plannedStartTime)}. Open driver POD: \${routeUrl}. Need help? Call 01803 222784. Reply STOP to unsubscribe.\`;`,
  `  const smsBody = \`Bathroom Panels Direct\\nDriver route ready\\n\${formatDriverSmsDate(route.date)}, start \${formatTime(route.plannedStartTime)}\\nOpen POD:\\n\${routeUrl}\`;`,
);

replaceOnce(
  "driver",
  "skip customer compliance injection for driver SMS",
  `        message: {\n          body: smsBody,\n        },\n      });`,
  `        message: {\n          body: smsBody,\n        },\n        includeHelpText: false,\n      });`,
);

replaceOnce(
  "notificationsRoute",
  "use realistic preview tracking URL",
  `trackingUrl: "https://www.bathroompanelsdirect.co.uk/apps/track/example",`,
  `trackingUrl: "https://www.bpd-delivery.uk/t/ABCDEFGH",`,
);

replaceOnce(
  "notificationsRoute",
  "short test SMS",
  `          body: "Bathroom Panels Direct SMS test. Your delivery SMS setup is working.",`,
  `          body: "Bathroom Panels Direct\\nSMS test successful\\nDelivery SMS setup is working",`,
);

replaceOnce(
  "notificationsRoute",
  "skip customer compliance injection for test SMS",
  `        message: {\n          body: "Bathroom Panels Direct\\nSMS test successful\\nDelivery SMS setup is working",\n        },\n      });`,
  `        message: {\n          body: "Bathroom Panels Direct\\nSMS test successful\\nDelivery SMS setup is working",\n        },\n        includeHelpText: false,\n      });`,
);

for (const [key, path] of Object.entries(files)) {
  writeFileSync(path, source[key]);
}

console.log("One-segment SMS wording and formatting hotfix applied.");
