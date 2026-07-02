import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { createSignedProofPhotoUrl } from "../lib/proofPhotoStorage.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const path = params["*"] || "";

  if (!path) {
    throw new Response("Proof image not found", { status: 404 });
  }

  const objectKey = `proof-of-delivery/${path}`;
  const signedUrl = await createSignedProofPhotoUrl(objectKey);

  if (!signedUrl) {
    throw new Response("Proof image not found", { status: 404 });
  }

  return redirect(signedUrl);
};
