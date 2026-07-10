import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import {
  createReadableStreamFromReadable,
  type ActionFunctionArgs,
  type EntryContext,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

const DRIVER_DELIVERY_RETRY_GUIDANCE = " Please check signal and press Complete delivery again. Proof is only saved after the app confirms the delivery.";

type DriverRouteErrorPayload = {
  ok?: boolean;
  error?: string;
  intent?: string;
  stopId?: string;
};

function isDriverRouteActionRequest(request: Request) {
  if (request.method.toUpperCase() !== "POST") {
    return false;
  }

  const pathname = new URL(request.url).pathname;
  return /^\/driver\/routes\/[^/]+\/?$/.test(pathname);
}

function isMultipartRequest(request: Request) {
  return /multipart\/form-data/i.test(request.headers.get("content-type") || "");
}

function addDriverDeliveryGuidance(message: string) {
  if (message.includes("Proof is only saved after the app confirms the delivery.")) {
    return message;
  }

  return message + DRIVER_DELIVERY_RETRY_GUIDANCE;
}

async function driverRouteErrorPayload(response: Response) {
  try {
    const payload = await response.clone().json();

    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return payload as DriverRouteErrorPayload;
    }
  } catch {
    // Use the controlled fallback response below if Remix did not return JSON.
  }

  return {};
}

export async function handleDataRequest(
  response: Response,
  { request }: LoaderFunctionArgs | ActionFunctionArgs,
) {
  if (!isDriverRouteActionRequest(request) || response.status < 400 || response.status === 404) {
    return response;
  }

  const payload = await driverRouteErrorPayload(response);
  const originalMessage = typeof payload.error === "string" && payload.error.trim()
    ? payload.error.trim()
    : "Driver route action failed.";
  const error = isMultipartRequest(request)
    ? addDriverDeliveryGuidance(originalMessage)
    : originalMessage;
  const headers = new Headers(response.headers);

  headers.delete("content-length");
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify({
    ...payload,
    ok: false,
    intent: payload.intent || "unknown",
    stopId: payload.stopId || "",
    error,
  }), {
    status: 400,
    headers,
  });
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
