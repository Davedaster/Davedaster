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

type DriverRouteFormContext = {
  intent: string;
  stopId: string;
};

const UNKNOWN_DRIVER_ROUTE_CONTEXT: DriverRouteFormContext = { intent: "unknown", stopId: "" };
const DELIVERY_RETRY_GUIDANCE = " Please check signal and press Complete delivery again. Proof is only saved after the app confirms the delivery.";

function driverRouteErrorMessage(intent: string, message: string) {
  const isDeliverySubmit = intent === "unknown" || intent === "completeStop" || intent === "completeCollectionStop";

  if (!isDeliverySubmit || message.includes("Proof is only saved after the app confirms the delivery.")) {
    return message;
  }

  return message + DELIVERY_RETRY_GUIDANCE;
}

async function readDriverRouteFormContext(request: Request | null) {
  if (!request) {
    return UNKNOWN_DRIVER_ROUTE_CONTEXT;
  }

  try {
    const formData = await request.formData();

    return {
      intent: String(formData.get("intent") || "startRoute"),
      stopId: String(formData.get("stopId") || "").trim(),
    };
  } catch {
    return UNKNOWN_DRIVER_ROUTE_CONTEXT;
  }
}

export const action = async (args: ActionFunctionArgs) => {
  const isMultipartUpload = /multipart\/form-data/i.test(args.request.headers.get("content-type") || "");
  const requestCopy = isMultipartUpload ? null : args.request.clone();

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
