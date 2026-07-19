import { readFileSync, writeFileSync } from "node:fs";

const notificationTemplatesPath = "app/lib/notificationTemplates.server.ts";
const notificationSendersPath = "app/lib/notificationSenders.server.ts";
let notificationTemplates = readFileSync(notificationTemplatesPath, "utf8");
let notificationSenders = readFileSync(notificationSendersPath, "utf8");

function replaceOnce(source, label, from, to) {
  if (source.includes(to)) {
    return source;
  }

  if (!source.includes(from)) {
    throw new Error(`Could not apply delivered review and SMS formatting hotfix: ${label}`);
  }

  return source.replace(from, to);
}

notificationTemplates = replaceOnce(
  notificationTemplates,
  "import SMS formatter into notification templates",
  `import { formatEtaSlot } from "./etaSlots.server";`,
  `import { formatEtaSlot } from "./etaSlots.server";\nimport { formatSmsBody } from "./smsFormatting";`,
);

notificationTemplates = replaceOnce(
  notificationTemplates,
  "add review URL constant",
  `const COMPANY_LOGO_URL = "https://cdn.shopify.com/s/files/1/0873/6250/2974/files/bathroom-panels-direct-logo-dark.png?v=1723113120";`,
  `const COMPANY_LOGO_URL = "https://cdn.shopify.com/s/files/1/0873/6250/2974/files/bathroom-panels-direct-logo-dark.png?v=1723113120";\nconst DELIVERY_REVIEW_URL = "https://review-bpd.s.gy/hHKdYF";`,
);

notificationTemplates = replaceOnce(
  notificationTemplates,
  "add delivered review helper",
  `export function notificationTemplateSupportsEmail(id: string) {\n  return id !== "delayUpdate";\n}`,
  `function addDeliveredReviewLink(body: string) {\n  if (body.includes(DELIVERY_REVIEW_URL)) {\n    return body;\n  }\n\n  const reviewText = \`Please support our family business by leaving us a review:\n\${DELIVERY_REVIEW_URL}\`;\n  const helpInstruction = "Need help? Call";\n  const stopInstruction = "Reply STOP to unsubscribe.";\n\n  if (body.includes(helpInstruction)) {\n    return body.replace(helpInstruction, \`\${reviewText}\\n\\n\${helpInstruction}\`);\n  }\n\n  if (body.includes(stopInstruction)) {\n    return body.replace(stopInstruction, \`\${reviewText}\\n\\n\${stopInstruction}\`);\n  }\n\n  return \`\${body}\\n\\n\${reviewText}\`.trim();\n}\n\nexport function notificationTemplateSupportsEmail(id: string) {\n  return id !== "delayUpdate";\n}`,
);

notificationTemplates = replaceOnce(
  notificationTemplates,
  "apply review link and professional layout to customer SMS",
  `  const body = renderLiquid(selectedTemplate.smsBody, context, "text");\n  if (channel === "sms" || !notificationTemplateSupportsEmail(selectedTemplate.id)) return { body };\n  return { subject: renderLiquid(selectedTemplate.emailSubject, context, "text"), body, html: renderLiquid(selectedTemplate.emailHtml, context, "html") };`,
  `  const body = renderLiquid(selectedTemplate.smsBody, context, "text");\n  const smsBody = formatSmsBody(channel === "sms" &&\n    selectedTemplate.id === "deliveryComplete" &&\n    input.serviceType !== "collection" &&\n    !input.leftInSafePlace\n    ? addDeliveredReviewLink(body)\n    : body);\n\n  if (channel === "sms" || !notificationTemplateSupportsEmail(selectedTemplate.id)) return { body: smsBody };\n  return { subject: renderLiquid(selectedTemplate.emailSubject, context, "text"), body, html: renderLiquid(selectedTemplate.emailHtml, context, "html") };`,
);

notificationSenders = replaceOnce(
  notificationSenders,
  "import SMS formatter into sender",
  `import type { NotificationMessage } from "./notificationTemplates.server";`,
  `import type { NotificationMessage } from "./notificationTemplates.server";\nimport { formatSmsBody } from "./smsFormatting";`,
);

notificationSenders = replaceOnce(
  notificationSenders,
  "format every outgoing SMS",
  `  const messageBody = input.includeHelpText === false\n    ? (input.message.body || "").trim()\n    : withSmsHelpText(input.message.body);`,
  `  const messageBody = formatSmsBody(input.includeHelpText === false\n    ? (input.message.body || "").trim()\n    : withSmsHelpText(input.message.body));`,
);

writeFileSync(notificationTemplatesPath, notificationTemplates);
writeFileSync(notificationSendersPath, notificationSenders);
console.log("Delivered review wording and SMS paragraph formatting hotfix applied.");
