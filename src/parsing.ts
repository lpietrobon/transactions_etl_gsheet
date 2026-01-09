// Parsing helpers for dates, currency, numbers, and rule regexes.
export function parseDateFallback(value: string): Date | null {
  if (!value) return null;
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function parseDate(value: string, format: string, timeZone: string): Date | null {
  if (!value) return null;
  if (typeof Utilities !== "undefined" && Utilities.parseDate) {
    try {
      return Utilities.parseDate(value, timeZone, format);
    } catch (_error) {
      return parseDateFallback(value);
    }
  }
  return parseDateFallback(value);
}

export function formatDateForSheet(date: Date, timeZone: string): string {
  if (typeof Utilities !== "undefined" && Utilities.formatDate) {
    return Utilities.formatDate(date, timeZone, "yyyy-MM-dd");
  }
  return date.toISOString().slice(0, 10);
}

export function parseCurrency(value: string): number {
  const cleaned = String(value || "")
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return 0;
  const isNegative = /^\(.*\)$/.test(cleaned);
  const normalized = cleaned.replace(/[()]/g, "");
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) return 0;
  return isNegative ? -Math.abs(parsed) : parsed;
}

export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isNaN(numeric) ? null : numeric;
}

export function buildRegex(value: unknown): RegExp | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  return new RegExp(raw, "i");
}
