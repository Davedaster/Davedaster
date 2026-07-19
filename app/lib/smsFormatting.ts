const SMS_SECTION_MARKERS = [
  "New ETA:",
  "ETA:",
  "Reason/details:",
  "Details:",
  "Track:",
  "Proof:",
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

const SMS_SECTION_PATTERN = new RegExp(
  `\\s*(${SMS_SECTION_MARKERS.map(escapeRegExp).join("|")})`,
  "gi",
);

export function formatSmsBody(value: string) {
  const formatted = (value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?=\d{1,2} )/g, "$1 ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .replace(SMS_SECTION_PATTERN, (_match, matchedMarker: string, offset: number) => (
      offset === 0 ? matchedMarker : `\n${matchedMarker}`
    ));

  return formatted
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
