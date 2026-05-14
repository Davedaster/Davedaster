export type EtaSlot = {
  stopId: string;
  estimatedArrival: Date;
  slotStart: Date;
  slotEnd: Date;
};

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

function routeDateWithStartTime(routeDate: Date, startTime: string) {
  const startMinutes = parseTimeToMinutes(startTime);
  const date = new Date(routeDate);
  date.setUTCHours(0, 0, 0, 0);

  return addMinutes(date, startMinutes);
}

export function formatEtaSlot(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
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
