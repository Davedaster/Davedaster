const UK_BANK_HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-04-03",
  "2026-04-06",
  "2026-05-04",
  "2026-05-25",
  "2026-08-31",
  "2026-12-25",
  "2026-12-28",
]);

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function isWorkingDay(date: Date) {
  return !isWeekend(date) && !UK_BANK_HOLIDAYS_2026.has(toDateKey(date));
}

export function subtractWorkingDays(startDate: Date, workingDays: number) {
  const date = new Date(Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  ));

  let remaining = workingDays;

  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);

    if (isWorkingDay(date)) {
      remaining -= 1;
    }
  }

  return date;
}

export function getLastWorkingDaysStart(workingDays: number) {
  const now = new Date();
  return subtractWorkingDays(now, workingDays);
}
