import prisma from "../db.server";

const SETTING_KEY = "driver_completion_message";
const DEFAULT_MESSAGE = "Nice one {{ driver.name }} 🎉 That is your last delivery completed for {{ route.name }}. Head back safely.";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce((current: unknown, key) => {
    if (!current || typeof current !== "object") return "";
    return (current as Record<string, unknown>)[key];
  }, value);
}

export function renderDriverCompletionMessage(template: string, input: { driverName?: string | null; routeName?: string | null; completedStops?: number; totalStops?: number }) {
  const context = {
    driver: { name: input.driverName || "driver" },
    route: { name: input.routeName || "your route", completed_stops: input.completedStops || 0, total_stops: input.totalStops || 0 },
  };

  return (clean(template) || DEFAULT_MESSAGE).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => String(valueAtPath(context, path) || "")).trim();
}

export async function getDriverCompletionMessageTemplate() {
  const record = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  return clean(record?.value) || DEFAULT_MESSAGE;
}

export async function saveDriverCompletionMessageTemplate(message: string) {
  const value = clean(message) || DEFAULT_MESSAGE;
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value },
    update: { value },
  });
  return value;
}

export function defaultDriverCompletionMessageTemplate() {
  return DEFAULT_MESSAGE;
}

export function driverCompletionVariables() {
  return ["{{ driver.name }}", "{{ route.name }}", "{{ route.completed_stops }}", "{{ route.total_stops }}"];
}
