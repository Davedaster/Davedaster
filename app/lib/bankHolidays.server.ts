const GOV_BANK_HOLIDAYS_URL = "https://www.gov.uk/bank-holidays.json";
const CACHE_MS = 24 * 60 * 60 * 1000;

export type FulfilmentDateOptions = {
  days?: number;
  useWorkingDaysOnly?: boolean;
};

type GovBankHolidayPayload = {
  "england-and-wales"?: {
    events?: Array<{
      title: string;
      date: string;
    }>;
  };
};

type CachedBankHolidays = {
  dates: Set<string>;
  expiresAt: number;
};

let cachedBankHolidays: CachedBankHolidays | null = null;

function dateOnly(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function normaliseDays(value: number | null | undefined) {
  return Number.isFinite(value) && typeof value === "number" ? Math.max(1, Math.round(value)) : 7;
}

async function getEnglandWalesBankHolidayDates() {
  const now = Date.now();

  if (cachedBankHolidays && cachedBankHolidays.expiresAt > now) {
    return cachedBankHolidays.dates;
  }

  try {
    const response = await fetch(GOV_BANK_HOLIDAYS_URL, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Bank holiday lookup failed with ${response.status}`);
    }

    const payload = await response.json() as GovBankHolidayPayload;
    const events = payload["england-and-wales"]?.events || [];
    const dates = new Set(events.map((event) => event.date).filter(Boolean));

    if (!dates.size) {
      throw new Error("No England and Wales bank holidays found.");
    }

    cachedBankHolidays = {
      dates,
      expiresAt: now + CACHE_MS,
    };

    return dates;
  } catch {
    if (cachedBankHolidays) {
      return cachedBankHolidays.dates;
    }

    return new Set<string>();
  }
}

function isWorkingDay(date: Date, bankHolidayDates: Set<string>) {
  const day = date.getUTCDay();

  if (day === 0 || day === 6) {
    return false;
  }

  return !bankHolidayDates.has(isoDate(date));
}

function addCalendarDays(orderDate: string | Date, days: number) {
  const date = dateOnly(orderDate);
  date.setUTCDate(date.getUTCDate() + days);

  return isoDate(date);
}

export async function fulfilByDateFromOrderDate(orderDate: string | Date, options: FulfilmentDateOptions = {}) {
  const days = normaliseDays(options.days);

  if (options.useWorkingDaysOnly === false) {
    return addCalendarDays(orderDate, days);
  }

  const bankHolidayDates = await getEnglandWalesBankHolidayDates();
  const date = dateOnly(orderDate);
  let daysAdded = 0;

  while (daysAdded < days) {
    date.setUTCDate(date.getUTCDate() + 1);

    if (isWorkingDay(date, bankHolidayDates)) {
      daysAdded += 1;
    }
  }

  return isoDate(date);
}
