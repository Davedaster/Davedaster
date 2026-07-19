import { readFileSync, writeFileSync } from "node:fs";

const notificationTemplatesPath = "app/lib/notificationTemplates.server.ts";
let source = readFileSync(notificationTemplatesPath, "utf8");

function replaceOnce(label, from, to) {
  if (source.includes(to)) {
    return;
  }

  if (!source.includes(from)) {
    throw new Error(`Could not apply delivered review link hotfix: ${label}`);
  }

  source = source.replace(from, to);
}

replaceOnce(
  "add review URL constant",
  `const COMPANY_LOGO_URL = "https://cdn.shopify.com/s/files/1/0873/6250/2974/files/bathroom-panels-direct-logo-dark.png?v=1723113120";`,
  `const COMPANY_LOGO_URL = "https://cdn.shopify.com/s/files/1/0873/6250/2974/files/bathroom-panels-direct-logo-dark.png?v=1723113120";\nconst DELIVERY_REVIEW_URL = "https://review-bpd.s.gy/hHKdYF";`,
);

replaceOnce(
  "add delivered review helper",
  `export function notificationTemplateSupportsEmail(id: string) {\n  return id !== "delayUpdate";\n}`,
  `function addDeliveredReviewLink(body: string) {\n  if (body.includes(DELIVERY_REVIEW_URL)) {\n    return body;\n  }\n\n  const reviewText = \`Please leave us a review: \${DELIVERY_REVIEW_URL}.\`;\n  const stopInstruction = "Reply STOP to unsubscribe.";\n\n  if (body.includes(stopInstruction)) {\n    return body.replace(stopInstruction, \`\${reviewText} \${stopInstruction}\`);\n  }\n\n  return \`\${body} \${reviewText}\`.trim();\n}\n\nexport function notificationTemplateSupportsEmail(id: string) {\n  return id !== "delayUpdate";\n}`,
);

replaceOnce(
  "apply review link to delivered SMS only",
  `  const body = renderLiquid(selectedTemplate.smsBody, context, "text");\n  if (channel === "sms" || !notificationTemplateSupportsEmail(selectedTemplate.id)) return { body };\n  return { subject: renderLiquid(selectedTemplate.emailSubject, context, "text"), body, html: renderLiquid(selectedTemplate.emailHtml, context, "html") };`,
  `  const body = renderLiquid(selectedTemplate.smsBody, context, "text");\n  const smsBody = channel === "sms" &&\n    selectedTemplate.id === "deliveryComplete" &&\n    input.serviceType !== "collection" &&\n    !input.leftInSafePlace\n    ? addDeliveredReviewLink(body)\n    : body;\n\n  if (channel === "sms" || !notificationTemplateSupportsEmail(selectedTemplate.id)) return { body: smsBody };\n  return { subject: renderLiquid(selectedTemplate.emailSubject, context, "text"), body, html: renderLiquid(selectedTemplate.emailHtml, context, "html") };`,
);

writeFileSync(notificationTemplatesPath, source);
console.log("Delivered SMS review link hotfix applied.");
