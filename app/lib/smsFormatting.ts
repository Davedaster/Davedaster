const SMS_SECTION_MARKERS = [
  "Delivery window:",
  "Return window:",
  "Updated window:",
  "Reason:",
  "View delivery details:",
  "View return details:",
  "View the update here:",
  "Open driver POD:",
  "Please support our family business by leaving us a review:",
  "Need help? Call",
  "Reply STOP to unsubscribe.",
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatSmsBody(value: string) {
  let formatted = (value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  for (const marker of SMS_SECTION_MARKERS) {
    const pattern = new RegExp(`\\s*(${escapeRegExp(marker)})`, "gi");
    formatted = formatted.replace(pattern, (_match, matchedMarker: string, offset: number) => (
      offset === 0 ? matchedMarker : `\n\n${matchedMarker}`
    ));
  }

  return formatted
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
