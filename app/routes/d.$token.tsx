import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = params.token || "";

  if (!token) {
    throw new Response("Driver route not found", { status: 404 });
  }

  return redirect(`/driver/routes/${encodeURIComponent(token)}`);
};
