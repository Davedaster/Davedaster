import { readFileSync, writeFileSync } from "node:fs";

function block(lines) {
  return lines.join("\n");
}

function replaceOnce(source, label, from, to) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Could not apply customer notification result guard: ${label}`);
  return source.replace(from, to);
}

function updateFile(path, updater) {
  const source = readFileSync(path, "utf8");
  const next = updater(source);
  writeFileSync(path, next);
}

updateFile("app/lib/routeNotifications.server.ts", (source) => {
  source = replaceOnce(
    source,
    "booked slot only marks sent after a real send",
    block([
      '  const summaryAction = failed ? "Notifications partially sent" : "Notifications sent";',
      '  const summaryDetails = `${smsSent} SMS sent, ${emailsSent} emails sent, ${skipped} orders skipped${failed ? `, ${failed} failed. Errors: ${errors.join(" | ")}` : ""}`;',
      '',
      '  await prisma.route.update({',
      '    where: { id: routeId },',
      '    data: {',
      '      ...(failed ? {} : { status: "NOTIFICATIONS_SENT", notificationsSent: true }),',
    ]),
    block([
      '  const sentCount = smsSent + emailsSent;',
      '  const zeroSentError = sentCount === 0',
      '    ? "No customer notifications were sent. Check customer phone/email details and notification provider settings."',
      '    : "";',
      '  const resultErrors = zeroSentError ? [...errors, zeroSentError] : errors;',
      '  const summaryAction = failed',
      '    ? (sentCount > 0 ? "Notifications partially sent" : "Notifications failed")',
      '    : (sentCount > 0 ? "Notifications sent" : "Notifications skipped");',
      '  const summaryDetails = `${smsSent} SMS sent, ${emailsSent} emails sent, ${skipped} orders skipped${failed ? `, ${failed} failed` : ""}${resultErrors.length ? `. Errors: ${resultErrors.join(" | ")}` : ""}`;',
      '  const shouldMarkNotificationsSent = sentCount > 0 && failed === 0;',
      '',
      '  await prisma.route.update({',
      '    where: { id: routeId },',
      '    data: {',
      '      ...(shouldMarkNotificationsSent ? { status: "NOTIFICATIONS_SENT", notificationsSent: true } : {}),',
    ]),
  );

  source = replaceOnce(
    source,
    "booked slot returns result errors",
    '  return { smsSent, emailsSent, skipped, failed, errors };',
    '  return { smsSent, emailsSent, skipped, failed, errors: resultErrors };',
  );

  source = replaceOnce(
    source,
    "manual updates only write sent history after a real send",
    block([
      '  const label = manualNotificationLabel(templateId);',
      '  const stopIds = marker?.stopIds?.length ? marker.stopIds : stops.map((stop) => stop.id);',
      '',
      '  await prisma.route.update({',
      '    where: { id: routeId },',
      '    data: {',
      '      history: {',
      '        create: {',
      '          action: `${label} sent`,',
      '          details: `${smsSent} SMS sent, ${emailsSent} emails sent, ${skipped} orders skipped${failed ? `, ${failed} failed` : ""}${notificationMarkerDetails({ ...marker, stopIds })}`,',
      '        },',
      '      },',
      '    },',
      '  });',
      '',
      '  return { smsSent, emailsSent, skipped, failed, errors };',
    ]),
    block([
      '  const label = manualNotificationLabel(templateId);',
      '  const stopIds = marker?.stopIds?.length ? marker.stopIds : stops.map((stop) => stop.id);',
      '  const sentCount = smsSent + emailsSent;',
      '  const zeroSentError = sentCount === 0',
      '    ? `No ${label.toLowerCase()} messages were sent. Check customer phone/email details and notification provider settings.`',
      '    : "";',
      '  const resultErrors = zeroSentError ? [...errors, zeroSentError] : errors;',
      '  const historyAction = sentCount > 0 ? `${label} sent` : `${label} failed`;',
      '',
      '  await prisma.route.update({',
      '    where: { id: routeId },',
      '    data: {',
      '      history: {',
      '        create: {',
      '          action: historyAction,',
      '          details: `${smsSent} SMS sent, ${emailsSent} emails sent, ${skipped} orders skipped${failed ? `, ${failed} failed` : ""}${resultErrors.length ? `. Errors: ${resultErrors.join(" | ")}` : ""}${notificationMarkerDetails({ ...marker, stopIds })}`,',
      '        },',
      '      },',
      '    },',
      '  });',
      '',
      '  return { smsSent, emailsSent, skipped, failed, errors: resultErrors };',
    ]),
  );

  return source;
});

updateFile("app/lib/deliveryCompleteNotifications.server.ts", (source) => {
  source = replaceOnce(
    source,
    "no provider delivery complete explains skipped messages",
    block([
      '  if (!canSendSms && !canSendEmail) {',
      '    return {',
      '      smsSent: 0,',
      '      emailsSent: 0,',
      '      skipped: input.orders.length,',
      '      failed: 0,',
      '      errors: [],',
      '    };',
      '  }',
    ]),
    block([
      '  if (!canSendSms && !canSendEmail) {',
      '    return {',
      '      smsSent: 0,',
      '      emailsSent: 0,',
      '      skipped: input.orders.length,',
      '      failed: 0,',
      '      errors: ["No delivery complete messages were sent because Twilio and Resend are not enabled."],',
      '    };',
      '  }',
    ]),
  );

  source = replaceOnce(
    source,
    "delivery complete returns zero sent error",
    block([
      '  return {',
      '    smsSent,',
      '    emailsSent,',
      '    skipped,',
      '    failed,',
      '    errors,',
      '  };',
    ]),
    block([
      '  const sentCount = smsSent + emailsSent;',
      '  const resultErrors = sentCount === 0',
      '    ? [...errors, "No delivery complete messages were sent. Check customer phone/email details and notification provider settings."]',
      '    : errors;',
      '',
      '  return {',
      '    smsSent,',
      '    emailsSent,',
      '    skipped,',
      '    failed,',
      '    errors: resultErrors,',
      '  };',
    ]),
  );

  return source;
});

updateFile("app/lib/proofOfDelivery.server.ts", (source) => {
  source = replaceOnce(
    source,
    "delivery complete history uses skipped action when nothing sent",
    block([
      '    await prisma.routeHistory.create({',
      '      data: {',
      '        routeId: stop.routeId,',
      '        action: "Delivery follow up completed",',
      '        details: `stopId:${input.stopId}. Shopify: ${shopifyResults.join(", ")}. Delivery complete notifications: ${notificationResult.smsSent} SMS sent, ${notificationResult.emailsSent} emails sent, ${notificationResult.skipped} skipped, ${notificationResult.failed} failed${notificationErrorDetails}`,' ,
      '      },',
      '    });',
    ]),
    block([
      '    const customerMessagesSent = notificationResult.smsSent + notificationResult.emailsSent;',
      '',
      '    await prisma.routeHistory.create({',
      '      data: {',
      '        routeId: stop.routeId,',
      '        action: customerMessagesSent > 0 ? "Delivery follow up completed" : "Delivery follow up skipped",',
      '        details: `stopId:${input.stopId}. Shopify: ${shopifyResults.join(", ")}. Delivery complete notifications: ${notificationResult.smsSent} SMS sent, ${notificationResult.emailsSent} emails sent, ${notificationResult.skipped} skipped, ${notificationResult.failed} failed${notificationErrorDetails}`,' ,
      '      },',
      '    });',
    ]),
  );

  return source;
});

updateFile("app/lib/driverRouteAccess.server.ts", (source) => {
  source = replaceOnce(
    source,
    "log swallowed first out for delivery failures",
    block([
      '  } catch {',
      '    // Customer notification checks must not stop the driver POD from loading.',
      '  }',
    ]),
    block([
      '  } catch (error) {',
      '    try {',
      '      const existingFailure = await prisma.routeHistory.findFirst({',
      '        where: {',
      '          routeId: route.id,',
      '          action: "Out for delivery failed",',
      '        },',
      '        orderBy: {',
      '          createdAt: "desc",',
      '        },',
      '      });',
      '',
      '      if (!existingFailure) {',
      '        await prisma.routeHistory.create({',
      '          data: {',
      '            routeId: route.id,',
      '            action: "Out for delivery failed",',
      '            details: error instanceof Error ? error.message : "Out for delivery notification failed.",',
      '          },',
      '        });',
      '      }',
      '    } catch {',
      '      // Customer notification checks must not stop the driver POD from loading.',
      '    }',
      '  }',
    ]),
  );

  return source;
});

updateFile("app/routes/app.routes.$routeId.tsx", (source) => {
  source = replaceOnce(
    source,
    "show notification result errors in message",
    block([
      'function notificationResultMessage(label: string, result: { smsSent: number; emailsSent: number; skipped: number; failed?: number }) {',
      '  return `${label}: ${result.smsSent} SMS, ${result.emailsSent} emails, ${result.skipped} skipped${result.failed ? `, ${result.failed} failed` : ""}.`;',
      '}',
    ]),
    block([
      'function notificationResultMessage(label: string, result: { smsSent: number; emailsSent: number; skipped: number; failed?: number; errors?: string[] }) {',
      '  const errorText = result.errors?.length ? ` Errors: ${result.errors.join(" | ")}` : "";',
      '',
      '  return `${label}: ${result.smsSent} SMS, ${result.emailsSent} emails, ${result.skipped} skipped${result.failed ? `, ${result.failed} failed` : ""}.${errorText}`;',
      '}',
    ]),
  );

  source = replaceOnce(
    source,
    "render action errors separately",
    block([
      '              {actionData && "message" in actionData ? <Text as="p" variant="bodyMd" tone="success">{actionData.message}</Text> : null}',
      '              {actionData && "error" in actionData ? <Text as="p" variant="bodyMd" tone="critical">{actionData.error}</Text> : null}',
    ]),
    block([
      '              {actionData && "message" in actionData ? <Text as="p" variant="bodyMd" tone="success">{actionData.message}</Text> : null}',
      '              {actionData && "error" in actionData ? <Text as="p" variant="bodyMd" tone="critical">{actionData.error}</Text> : null}',
      '              {actionData && "errors" in actionData && Array.isArray(actionData.errors) && actionData.errors.length ? <Text as="p" variant="bodyMd" tone="critical">{actionData.errors.join(" | ")}</Text> : null}',
    ]),
  );

  return source;
});

updateFile("app/routes/app.routes.tsx", (source) => {
  source = replaceOnce(
    source,
    "add publish error helper",
    block([
      'function tick(value: boolean) {',
      '  return value ? "✓" : "✗";',
      '}',
    ]),
    block([
      'function tick(value: boolean) {',
      '  return value ? "✓" : "✗";',
      '}',
      '',
      'function errorMessage(error: unknown) {',
      '  return error instanceof Error ? error.message : "Unknown error";',
      '}',
    ]),
  );

  source = replaceOnce(
    source,
    "main routes publish keeps route published when notifications fail",
    block([
      '      await publishRoute(routeId);',
      '      await calculateEtaSlots(routeId);',
      '      await tagPublishedRouteOrders(admin, routeId);',
      '',
      '      const fulfilmentSettings = await getFulfilmentSettings();',
      '      const fulfilOnPublish = fulfilmentSettings.routePublishFulfilmentMode === "on_publish" || fulfilmentSettings.routePublishFulfilmentMode === "on_publish_delivered";',
      '      const fulfilmentResult = fulfilOnPublish',
      '        ? await fulfilRouteOrders(admin, routeId, {',
      '          markDelivered: fulfilmentSettings.routePublishFulfilmentMode === "on_publish_delivered",',
      '          notifyCustomer: fulfilmentSettings.notifyCustomerOnFulfilment,',
      '        })',
      '        : { fulfilled: 0, skipped: 0, errors: [] };',
      '      const driverResult = await sendDriverRouteLink({ routeId, request });',
      '      const customerResult = await sendBookedSlotNotifications(routeId);',
      '      const errors = [...fulfilmentResult.errors, ...driverResult.errors, ...customerResult.errors];',
      '      const fulfilmentToastTitle = fulfilmentSettings.routePublishFulfilmentMode === "on_publish_delivered"',
      '        ? "Shopify fulfilled and delivered on publish"',
      '        : fulfilmentSettings.routePublishFulfilmentMode === "on_publish"',
      '          ? "Shopify fulfilment on publish"',
      '          : "Shopify fulfilment";',
    ]),
    block([
      '      await publishRoute(routeId);',
      '      await calculateEtaSlots(routeId);',
      '',
      '      const tagResult = { errors: [] as string[] };',
      '      try {',
      '        await tagPublishedRouteOrders(admin, routeId);',
      '      } catch (error) {',
      '        tagResult.errors.push(`Shopify tagging step failed: ${errorMessage(error)}`);',
      '      }',
      '',
      '      let fulfilmentMode = "on_delivery_complete";',
      '      let fulfilOnPublish = false;',
      '      let fulfilmentResult = { fulfilled: 0, skipped: 0, errors: [] as string[] };',
      '      try {',
      '        const fulfilmentSettings = await getFulfilmentSettings();',
      '        fulfilmentMode = fulfilmentSettings.routePublishFulfilmentMode;',
      '        fulfilOnPublish = fulfilmentMode === "on_publish" || fulfilmentMode === "on_publish_delivered";',
      '        fulfilmentResult = fulfilOnPublish',
      '          ? await fulfilRouteOrders(admin, routeId, {',
      '            markDelivered: fulfilmentMode === "on_publish_delivered",',
      '            notifyCustomer: fulfilmentSettings.notifyCustomerOnFulfilment,',
      '          })',
      '          : fulfilmentResult;',
      '      } catch (error) {',
      '        fulfilmentResult.errors.push(`Shopify fulfilment step failed: ${errorMessage(error)}`);',
      '      }',
      '',
      '      let driverResult = { smsSent: false, emailSent: false, errors: [] as string[] };',
      '      try {',
      '        driverResult = await sendDriverRouteLink({ routeId, request });',
      '      } catch (error) {',
      '        driverResult.errors.push(`Driver route link step failed: ${errorMessage(error)}`);',
      '      }',
      '',
      '      let customerResult = { smsSent: 0, emailsSent: 0, skipped: 0, failed: 0, errors: [] as string[] };',
      '      try {',
      '        customerResult = await sendBookedSlotNotifications(routeId);',
      '      } catch (error) {',
      '        customerResult.errors.push(`Customer booked slot notification step failed: ${errorMessage(error)}`);',
      '      }',
      '',
      '      const errors = [...tagResult.errors, ...fulfilmentResult.errors, ...driverResult.errors, ...customerResult.errors];',
      '      const fulfilmentToastTitle = fulfilmentMode === "on_publish_delivered"',
      '        ? "Shopify fulfilled and delivered on publish"',
      '        : fulfilmentMode === "on_publish"',
      '          ? "Shopify fulfilment on publish"',
      '          : "Shopify fulfilment";',
    ]),
  );

  source = replaceOnce(
    source,
    "main routes publish uses guarded fulfilment mode",
    'return json<RouteActionData>({ ok: true, message: publishMessage({ driverSms: driverResult.smsSent, driverEmail: driverResult.emailSent, customerSms: customerResult.smsSent, customerEmail: customerResult.emailsSent, customerSkipped: customerResult.skipped, fulfilmentMode: fulfilmentSettings.routePublishFulfilmentMode, fulfilmentFulfilled: fulfilmentResult.fulfilled, fulfilmentSkipped: fulfilmentResult.skipped, errors }), errors, toasts });',
    'return json<RouteActionData>({ ok: true, message: publishMessage({ driverSms: driverResult.smsSent, driverEmail: driverResult.emailSent, customerSms: customerResult.smsSent, customerEmail: customerResult.emailsSent, customerSkipped: customerResult.skipped, fulfilmentMode, fulfilmentFulfilled: fulfilmentResult.fulfilled, fulfilmentSkipped: fulfilmentResult.skipped, errors }), errors, toasts });',
  );

  return source;
});

updateFile("app/routes/driver.routes.$token.tsx", (source) => {
  source = replaceOnce(
    source,
    "driver start route does not fail on notification error",
    block([
      '      if (isEtaDueForFirstNotification(firstEta)) {',
      '        await sendFirstOutForDeliveryNotification(route.id);',
      '      }',
      '',
      '      return redirect(`/driver/routes/${token}`);',
    ]),
    block([
      '      if (isEtaDueForFirstNotification(firstEta)) {',
      '        try {',
      '          await sendFirstOutForDeliveryNotification(route.id);',
      '        } catch (error) {',
      '          try {',
      '            await prisma.routeHistory.create({',
      '              data: {',
      '                routeId: route.id,',
      '                action: "Out for delivery failed",',
      '                details: error instanceof Error ? error.message : "Out for delivery notification failed.",',
      '              },',
      '            });',
      '          } catch {',
      '            // Customer notification checks must not stop the driver starting the route.',
      '          }',
      '        }',
      '      }',
      '',
      '      return redirect(`/driver/routes/${token}`);',
    ]),
  );

  return source;
});

console.log("Customer notification result guard hotfix applied.");