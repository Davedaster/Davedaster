export function formatEtaSlot(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });

  return `${formatter.format(start)} to ${formatter.format(end)}`;
}
