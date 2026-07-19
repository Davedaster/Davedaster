const SMS_SECTION_MARKERS = [
  "ETA:",
  "New ETA:",
  "Track:",
  "Proof:",
  "Details:",
  "Reason/details:",
  "Open POD:",
  "Please support our family business by leaving us a review:",
  "Help:",
  "Need help? Call",
  "Reply STOP to opt out.",
  "Reply STOP to unsubscribe.",
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatSmsBody(value: string) {
  let formatted = (value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  for (const marker of SMS_SECTION_MARKERS) {
    const pattern = new RegExp(`[ \\t]*(?:\\n[ \\t]*)?(${escapeRegExp(marker)})`, "gi");
    formatted = formatted.replace(pattern, (_match, matchedMarker: string, offset: number) => (
      offset === 0 ? matchedMarker : `\n${matchedMarker}`
    ));
  }

  return formatted
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
