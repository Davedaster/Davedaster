import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import DriverRoutePage, {
  action as runDriverRouteAction,
  loader,
} from "./.driver.routes.$token.source";

export { loader };
export default DriverRoutePage;

type DriverRouteErrorPayload = {
  ok?: boolean;
  error?: string;
};

const DELIVERY_RETRY_GUIDANCE = " Please check signal and press Complete delivery again. Proof is only saved after the app confirms the delivery.";

function driverRouteErrorMessage(intent: string, message: string) {
  const isDeliverySubmit = intent === "unknown" || intent === "completeStop" || intent === "completeCollectionStop";

  if (!isDeliverySubmit || message.includes("Proof is only saved after the app confirms the delivery.")) {
    return message;
  }

  return message + DELIVERY_RETRY_GUIDANCE;
}

async function readDriverRouteFormContext(request: Request) {
  try {
    const formData = await request.formData();

    return {
      intent: String(formData.get("intent") || "startRoute"),
      stopId: String(formData.get("stopId") || "").trim(),
    };
  } catch {
    return { intent: "unknown", stopId: "" };
  }
}

export const action = async (args: ActionFunctionArgs) => {
  const requestCopy = args.request.clone();

  try {
    const response = await runDriverRouteAction(args);

    if (response.status !== 400) {
      return response;
    }

    const { intent, stopId } = await readDriverRouteFormContext(requestCopy);
    let payload: DriverRouteErrorPayload = {};

    try {
      payload = await response.clone().json() as DriverRouteErrorPayload;
    } catch {
      // Convert an unexpected non-JSON action failure into the normal driver response below.
    }

    const message = payload.error || "Driver route action failed.";

    return json({
      ...payload,
      ok: false,
      intent,
      stopId,
      error: driverRouteErrorMessage(intent, message),
    }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    const { intent, stopId } = await readDriverRouteFormContext(requestCopy);
    const message = error instanceof Error ? error.message : "Driver route action failed.";

    return json({
      ok: false,
      intent,
      stopId,
      error: driverRouteErrorMessage(intent, message),
    }, { status: 400 });
  }
};
