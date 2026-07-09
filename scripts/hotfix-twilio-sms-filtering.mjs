import { readFileSync, writeFileSync } from "node:fs";

function block(lines) {
  return lines.join("\n");
}

function replaceOnce(source, label, from, to) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Could not apply Twilio SMS filtering hotfix: ${label}`);
  return source.replace(from, to);
}

function updateFile(path, updater) {
  const source = readFileSync(path, "utf8");
  const next = updater(source);
  writeFileSync(path, next);
}

updateFile("app/lib/notificationTemplates.server.ts", (source) => {
  source = replaceOnce(
    source,
    "bump SMS template version so stored filtered wording is refreshed",
    'const SMS_TEMPLATE_VERSION = "customer_sms_restore_2026_07_08";',
    'const SMS_TEMPLATE_VERSION = "customer_sms_filter_safe_2026_07_09";',
  );

  source = replaceOnce(
    source,
    "safe place delivery complete SMS",
    block([
      'const safePlaceDeliveryCompleteSmsBody = `Hi {{ customer.name }}, your Bathroom Panels Direct delivery for {{ order.number }} has been completed and left safely at the property. View delivery proof here: {{ tracking.url }}',
      '',
      "If you're happy with the service, a quick Google review really helps our family business: ${GOOGLE_REVIEW_URL}",
      '',
      'Need help? Call {{ company.phone }}`;',
    ]),
    'const safePlaceDeliveryCompleteSmsBody = `Bathroom Panels Direct: Your delivery for order {{ order.number }} has been completed and left safely at the property. View delivery details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.`;',
  );

  source = replaceOnce(
    source,
    "booked delivery SMS",
    '    smsBody: "Hi {{ customer.name }}, your Bathroom Panels Direct delivery for {{ order.number }} is booked for {{ delivery.date }}, {{ delivery.eta_slot }}. Track it here: {{ tracking.url }}\\n\\nNeed help? Call {{ company.phone }}",',
    '    smsBody: "Bathroom Panels Direct: Your delivery for order {{ order.number }} is planned for {{ delivery.date }}, {{ delivery.eta_slot }}. View delivery details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",',
  );

  source = replaceOnce(
    source,
    "out for delivery SMS",
    '    smsBody: "Hi {{ customer.name }}, your order is out for delivery. {% if driver.name %}Your driver is {{ driver.name }}. {% endif %}Current slot: {{ delivery.eta_slot }}. Track it here: {{ tracking.url }}\\n\\nNeed help? Call {{ company.phone }}",',
    '    smsBody: "Bathroom Panels Direct: Your order {{ order.number }} is out for delivery today. {% if driver.name %}Your driver is {{ driver.name }}. {% endif %}Delivery window: {{ delivery.eta_slot }}. View delivery details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",',
  );

  source = replaceOnce(
    source,
    "next drop SMS",
    '    smsBody: "Hi {{ customer.name }}, good news, {% if driver.name %}{{ driver.name }} is{% else %}our driver is{% endif %} heading to you next. Track here: {{ tracking.url }}\\n\\nNeed help? Call {{ company.phone }}",',
    '    smsBody: "Bathroom Panels Direct: You are the next delivery stop for order {{ order.number }}. Please keep access clear. View delivery details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",',
  );

  source = replaceOnce(
    source,
    "delay update SMS",
    '    smsBody: "Hi {{ customer.name }}, sorry, your delivery is running around {{ delay.minutes }} minutes later than planned. Updated slot: {{ delivery.eta_slot }}. Track here: {{ tracking.url }}\\n\\nNeed help? Call {{ company.phone }}",',
    '    smsBody: "Bathroom Panels Direct: Your delivery for order {{ order.number }} is running about {{ delay.minutes }} minutes later than planned. Updated window: {{ delivery.eta_slot }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",',
  );

  source = replaceOnce(
    source,
    "delivery complete SMS",
    block([
      '    smsBody: "{% if delivery.left_in_safe_place %}" + safePlaceDeliveryCompleteSmsBody + `{% else %}Hi {{ customer.name }}, your Bathroom Panels Direct delivery for {{ order.number }} has been completed. Thank you for your order.',
      '',
      "If you're happy with the service, a quick Google review really helps our family business: ${GOOGLE_REVIEW_URL}",
      '',
      'Need help? Call {{ company.phone }}{% endif %}`,',
    ]),
    '    smsBody: "{% if delivery.left_in_safe_place %}" + safePlaceDeliveryCompleteSmsBody + `{% else %}Bathroom Panels Direct: Your delivery for order {{ order.number }} has been completed. Thank you for your order. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.{% endif %}`,',
  );

  source = replaceOnce(
    source,
    "booked return SMS",
    '    smsBody: "Hi {{ customer.name }}, your Bathroom Panels Direct return for {{ order.number }} is booked for {{ delivery.date }}, {{ delivery.eta_slot }}. Track it here: {{ tracking.url }}\\n\\nNeed help? Call {{ company.phone }}",',
    '    smsBody: "Bathroom Panels Direct: Your return for order {{ order.number }} is planned for {{ delivery.date }}, {{ delivery.eta_slot }}. View return details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",',
  );

  source = replaceOnce(
    source,
    "return out today SMS",
    '    smsBody: "Hi {{ customer.name }}, your return is out today. {% if driver.name %}Your driver is {{ driver.name }}. {% endif %}Current slot: {{ delivery.eta_slot }}. Track it here: {{ tracking.url }}\\n\\nNeed help? Call {{ company.phone }}",',
    '    smsBody: "Bathroom Panels Direct: Your return for order {{ order.number }} is scheduled for today. {% if driver.name %}Your driver is {{ driver.name }}. {% endif %}Return window: {{ delivery.eta_slot }}. View return details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",',
  );

  source = replaceOnce(
    source,
    "next return SMS",
    '    smsBody: "Hi {{ customer.name }}, good news, {% if driver.name %}{{ driver.name }} is{% else %}our driver is{% endif %} heading to you next for your return. Track here: {{ tracking.url }}\\n\\nNeed help? Call {{ company.phone }}",',
    '    smsBody: "Bathroom Panels Direct: You are the next return stop for order {{ order.number }}. Please keep access clear. View return details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",',
  );

  source = replaceOnce(
    source,
    "return delay SMS",
    '    smsBody: "Hi {{ customer.name }}, sorry, your return is running around {{ delay.minutes }} minutes later than planned. Updated slot: {{ delivery.eta_slot }}. Track here: {{ tracking.url }}\\n\\nNeed help? Call {{ company.phone }}",',
    '    smsBody: "Bathroom Panels Direct: Your return for order {{ order.number }} is running about {{ delay.minutes }} minutes later than planned. Updated window: {{ delivery.eta_slot }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",',
  );

  source = replaceOnce(
    source,
    "return complete SMS",
    '    smsBody: "Hi {{ customer.name }}, your return for {{ order.number }} has been completed. The items will be checked before any refund, replacement or further action is confirmed. View proof here: {{ tracking.url }}\\n\\nNeed help? Call {{ company.phone }}",',
    '    smsBody: "Bathroom Panels Direct: Your return for order {{ order.number }} has been completed. We will check the returned items before confirming the next step. View return details: {{ tracking.url }}. Need help? Call {{ company.phone }}. Reply STOP to unsubscribe.",',
  );

  return source;
});

updateFile("app/lib/driverRouteAccess.server.ts", (source) => {
  source = replaceOnce(
    source,
    "driver POD SMS wording",
    '  const smsBody = `Bathroom Panels Direct route ${route.name} for ${formatDate(route.date)}. Start ${formatTime(route.plannedStartTime)}. Open: ${routeUrl}`;',
    '  const smsBody = `Bathroom Panels Direct: Driver route ${route.name} is ready for ${formatDate(route.date)}. Start ${formatTime(route.plannedStartTime)}. Open driver POD: ${routeUrl}. Need help? Call 01803 222784. Reply STOP to unsubscribe.`;',
  );

  source = replaceOnce(
    source,
    "driver POD SMS history label",
    '      details: `Secure driver route link sent. SMS: ${smsSent ? "sent" : "not sent"}. Email: ${emailSent ? "sent" : "not sent"}.${errors.length ? ` Errors: ${errors.join(" | ")}` : ""}`,',
    '      details: `Secure driver route link sent. SMS: ${smsSent ? "submitted to Twilio" : "not submitted"}. Email: ${emailSent ? "sent" : "not sent"}.${errors.length ? ` Errors: ${errors.join(" | ")}` : ""}`,',
  );

  return source;
});

updateFile("app/lib/routeNotifications.server.ts", (source) => {
  source = replaceOnce(
    source,
    "booked slot summary says submitted",
    '  const summaryDetails = `${smsSent} SMS sent, ${emailsSent} emails sent, ${skipped} orders skipped${failed ? `, ${failed} failed` : ""}${resultErrors.length ? `. Errors: ${resultErrors.join(" | ")}` : ""}`;',
    '  const summaryDetails = `${smsSent} SMS submitted to Twilio, ${emailsSent} emails sent, ${skipped} orders skipped${failed ? `, ${failed} failed` : ""}${resultErrors.length ? `. Errors: ${resultErrors.join(" | ")}` : ""}`;',
  );

  source = replaceOnce(
    source,
    "manual update summary says submitted",
    '          details: `${smsSent} SMS sent, ${emailsSent} emails sent, ${skipped} orders skipped${failed ? `, ${failed} failed` : ""}${resultErrors.length ? `. Errors: ${resultErrors.join(" | ")}` : ""}${notificationMarkerDetails({ ...marker, stopIds })}`,',
    '          details: `${smsSent} SMS submitted to Twilio, ${emailsSent} emails sent, ${skipped} orders skipped${failed ? `, ${failed} failed` : ""}${resultErrors.length ? `. Errors: ${resultErrors.join(" | ")}` : ""}${notificationMarkerDetails({ ...marker, stopIds })}`,',
  );

  return source;
});

updateFile("app/routes/app.routes.$routeId.tsx", (source) => {
  source = replaceOnce(
    source,
    "route details notification result says submitted",
    '  return `${label}: ${result.smsSent} SMS, ${result.emailsSent} emails, ${result.skipped} skipped${result.failed ? `, ${result.failed} failed` : ""}.${errorText}`;',
    '  return `${label}: ${result.smsSent} SMS submitted to Twilio, ${result.emailsSent} emails, ${result.skipped} skipped${result.failed ? `, ${result.failed} failed` : ""}.${errorText}`;',
  );

  source = replaceOnce(source, "route details publish driver SMS label", '    `Driver SMS ${tick(input.driverSms)}`,', '    `Driver SMS submitted ${tick(input.driverSms)}`,');
  source = replaceOnce(source, "route details publish customer SMS label", '    `Customer SMS ${input.customerSms > 0 ? "✓" : "✗"} (${input.customerSms} sent)`,', '    `Customer SMS submitted ${input.customerSms > 0 ? "✓" : "✗"} (${input.customerSms} submitted)`,');
  source = replaceOnce(source, "customer notifications action label", 'notificationResultMessage("Customer notifications sent", result)', 'notificationResultMessage("Customer notifications submitted", result)');
  source = replaceOnce(source, "out for delivery action label", 'notificationResultMessage("Out for delivery sent", result)', 'notificationResultMessage("Out for delivery submitted", result)');
  source = replaceOnce(source, "delay update action label", 'notificationResultMessage("Delay update sent", result)', 'notificationResultMessage("Delay update submitted", result)');
  source = replaceOnce(source, "next drop action label", 'notificationResultMessage("Next drop message sent", result)', 'notificationResultMessage("Next drop message submitted", result)');
  source = replaceOnce(source, "driver route link action label", 'message: `Driver route link sent: SMS ${tick(result.smsSent)}, email ${tick(result.emailSent)}.`', 'message: `Driver route link submitted: SMS ${tick(result.smsSent)}, email ${tick(result.emailSent)}.`');

  return source;
});

updateFile("app/routes/app.routes.tsx", (source) => {
  source = replaceOnce(source, "main routes publish driver SMS label", '    `Driver SMS ${tick(input.driverSms)}`,', '    `Driver SMS submitted ${tick(input.driverSms)}`,');
  source = replaceOnce(source, "main routes publish customer SMS label", '    `Customer SMS ${input.customerSms > 0 ? "✓" : "✗"} (${input.customerSms} sent)`,', '    `Customer SMS submitted ${input.customerSms > 0 ? "✓" : "✗"} (${input.customerSms} submitted)`,');
  source = replaceOnce(source, "main routes driver SMS toast title", 'actionToast(driverResult.smsSent ? "Driver SMS sent" : "Driver SMS not sent", `${route.name} sent to ${driverName}`, driverResult.smsSent ? "success" : "info")', 'actionToast(driverResult.smsSent ? "Driver SMS submitted" : "Driver SMS not submitted", `${route.name} sent to ${driverName}`, driverResult.smsSent ? "success" : "info")');
  source = replaceOnce(source, "main routes customer SMS toast detail", 'actionToast("Customer SMS update", `${customerResult.smsSent} sent, ${customerResult.skipped} skipped`, customerResult.smsSent ? "success" : "info")', 'actionToast("Customer SMS update", `${customerResult.smsSent} submitted, ${customerResult.skipped} skipped`, customerResult.smsSent ? "success" : "info")');

  return source;
});

updateFile("app/lib/proofOfDelivery.server.ts", (source) => {
  source = replaceOnce(
    source,
    "delivery complete history says submitted",
    '        details: `stopId:${input.stopId}. Shopify: ${shopifyResults.join(", ")}. Delivery complete notifications: ${notificationResult.smsSent} SMS sent, ${notificationResult.emailsSent} emails sent, ${notificationResult.skipped} skipped, ${notificationResult.failed} failed${notificationErrorDetails}`,',
    '        details: `stopId:${input.stopId}. Shopify: ${shopifyResults.join(", ")}. Delivery complete notifications: ${notificationResult.smsSent} SMS submitted to Twilio, ${notificationResult.emailsSent} emails sent, ${notificationResult.skipped} skipped, ${notificationResult.failed} failed${notificationErrorDetails}`,',
  );

  return source;
});

console.log("Twilio SMS filtering hotfix applied.");
