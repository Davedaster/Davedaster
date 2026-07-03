export type EtaSlot = {
  stopId: string;
  estimatedArrival: Date;
  slotStart: Date;
  slotEnd: Date;
};

const ROUTE_TIME_ZONE = "Europe/London";

function parseTimeToMinutes(value: string) {
  const [hours, minutes = "0"] = value.split(":");
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);

  if (!Number.isFinite(parsedHours) || !Number.isFinite(parsedMinutes)) {
    return 5 * 60;
  }

  return parsedHours * 60 + parsedMinutes;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function londonOffsetMinutes(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: ROUTE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values: Record<string, string> = {};

  for (const part of formatter.formatToParts(date)) {
    values[part.type] = part.value;
  }

  const localAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return Math.round((localAsUtc - date.getTime()) / 60000);
}

function routeDateWithStartTime(routeDate: Date, startTime: string) {
  const startMinutes = parseTimeToMinutes(startTime);
  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  const date = new Date(routeDate);
  const localClockTime = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hours,
    minutes,
    0,
    0,
  ));

  return addMinutes(localClockTime, -londonOffsetMinutes(localClockTime));
}

export function formatEtaSlot(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ROUTE_TIME_ZONE,
  });

  return `${formatter.format(start)} to ${formatter.format(end)}`;
}

export function buildEtaSlots(
  stops: Array<{ id: string; orderIndex: number }>,
  routeDate: Date,
  startTime = "05:00",
  stopMinutes = 10,
  slotMinutes = 60,
) {
  const routeStart = routeDateWithStartTime(routeDate, startTime);

  return [...stops]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((stop, index) => {
      const estimatedArrival = addMinutes(routeStart, index * stopMinutes);
      const slotStart = estimatedArrival;
      const slotEnd = addMinutes(slotStart, slotMinutes);

      return {
        stopId: stop.id,
        estimatedArrival,
        slotStart,
        slotEnd,
      };
    });
}
