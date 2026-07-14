import fs from "node:fs";

const helperPath = "app/lib/driverProofDrafts.client.ts";
const helper = fs.readFileSync(helperPath, "utf8");

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  }
  return source.replace(before, after);
}

let next = helper;

next = replaceOnce(
  next,
  '  collectionSignature?: string;\n};',
  '  collectionSignature?: string;\n  submissionId?: string;\n};',
  "draft submission id type",
);

next = replaceOnce(
  next,
  'function driverPodDraftKeyFromFormData(formData: FormData) {\n  const stopId = String(formData.get("stopId") || "").trim();\n  return stopId ? `driver-pod:${window.location.pathname}:${stopId}` : "";\n}\n\nasync function persistDriverPodSubmission(formData: FormData, draftKey: string) {\n  if (!draftKey) return;',
  'function driverPodDraftKeyFromFormData(formData: FormData) {\n  const stopId = String(formData.get("stopId") || "").trim();\n  return stopId ? `driver-pod:${window.location.pathname}:${stopId}` : "";\n}\n\nfunction createDriverPodSubmissionId() {\n  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {\n    return crypto.randomUUID();\n  }\n\n  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;\n}\n\nasync function persistDriverPodSubmission(formData: FormData, draftKey: string) {\n  if (!draftKey) return "";',
  "submission id generator",
);

next = replaceOnce(
  next,
  '  if (intent !== "completeStop" && intent !== "completeCollectionStop") return;\n\n  const proofFiles',
  '  if (intent !== "completeStop" && intent !== "completeCollectionStop") return "";\n\n  const proofFiles',
  "persist invalid intent return",
);

next = replaceOnce(
  next,
  '  const existing = await readDriverPodDraft(draftKey);\n\n  await writeDriverPodDraft(draftKey, {',
  '  const existing = await readDriverPodDraft(draftKey);\n  const submissionId = existing?.submissionId || createDriverPodSubmissionId();\n  formData.set("submissionId", submissionId);\n\n  await writeDriverPodDraft(draftKey, {',
  "persist submission id",
);

next = replaceOnce(
  next,
  '    collectionSignature: String(formData.get("collectionSignature") || existing?.collectionSignature || ""),\n  });\n}',
  '    collectionSignature: String(formData.get("collectionSignature") || existing?.collectionSignature || ""),\n    submissionId,\n  });\n\n  return submissionId;\n}',
  "return submission id",
);

next = replaceOnce(
  next,
  'async function driverPodErrorMessage(response: Response) {',
  'async function checkDriverPodCompletionStatus(formData: FormData) {\n  const stopId = String(formData.get("stopId") || "").trim();\n  const intent = String(formData.get("intent") || "").trim();\n  const submissionId = String(formData.get("submissionId") || "").trim();\n\n  if (!stopId || (intent !== "completeStop" && intent !== "completeCollectionStop")) {\n    return false;\n  }\n\n  const token = window.location.pathname.split("/").filter(Boolean).at(-1) || "";\n  const query = new URLSearchParams({ stopId, intent, submissionId });\n  const response = await fetch(`/driver/routes/${encodeURIComponent(token)}/completion-status?${query.toString()}`, {\n    method: "GET",\n    credentials: "same-origin",\n    headers: { Accept: "application/json" },\n  });\n\n  if (!response.ok) {\n    const message = await driverPodErrorMessage(response);\n    throw new Error(message);\n  }\n\n  const data = await response.json() as { completed?: boolean };\n  return Boolean(data.completed);\n}\n\nasync function driverPodErrorMessage(response: Response) {',
  "completion status preflight",
);

next = replaceOnce(
  next,
  '      await persistDriverPodSubmission(formData, draftKey);\n      await appendRestoredDriverPodProof(formData, draftKey);\n\n      const response = await fetch',
  '      await persistDriverPodSubmission(formData, draftKey);\n      await appendRestoredDriverPodProof(formData, draftKey);\n\n      if (await checkDriverPodCompletionStatus(formData)) {\n        await clearDriverPodDraft(draftKey);\n        window.location.assign(`${window.location.pathname}#next-stop`);\n        return "success";\n      }\n\n      const response = await fetch',
  "preflight before upload submission",
);

fs.writeFileSync(helperPath, next);

const statusRoutePath = "app/routes/driver.routes.$token.completion-status.ts";
const statusRoute = `import type { LoaderFunctionArgs } from "@remix-run/node";\nimport { json } from "@remix-run/node";\n\nimport prisma from "../db.server";\n\nexport const loader = async ({ request, params }: LoaderFunctionArgs) => {\n  const token = params.token;\n  const url = new URL(request.url);\n  const stopId = url.searchParams.get("stopId")?.trim() || "";\n  const intent = url.searchParams.get("intent")?.trim() || "";\n\n  if (!token || !stopId || (intent !== "completeStop" && intent !== "completeCollectionStop")) {\n    return json({ completed: false, error: "Completion status request is incomplete." }, { status: 400 });\n  }\n\n  const stop = await prisma.stop.findFirst({\n    where: {\n      id: stopId,\n      route: { driverAccessToken: token },\n    },\n    select: {\n      status: true,\n      returnTickets: { select: { id: true }, take: 1 },\n    },\n  });\n\n  if (!stop) {\n    return json({ completed: false, error: "Stop not found for this driver route." }, { status: 404 });\n  }\n\n  const isCollection = stop.returnTickets.length > 0;\n  if ((intent === "completeCollectionStop") !== isCollection) {\n    return json({ completed: false, error: "Stop type does not match this completion request." }, { status: 400 });\n  }\n\n  return json({\n    completed: stop.status === "DELIVERED",\n    resolved: stop.status === "DELIVERED" || stop.status === "FAILED",\n    status: stop.status,\n  });\n};\n`;

fs.writeFileSync(statusRoutePath, statusRoute);

console.log("Applied driver POD completion preflight protection.");
