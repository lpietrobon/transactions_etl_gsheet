// Tests for parsing helpers used by ingestion and categorization.
import { buildRegex, formatDateForSheet, parseCurrency, parseDate, parseNumber } from "../src/parsing";

describe("parseCurrency", () => {
  it("parses currency with symbols and commas", () => {
    expect(parseCurrency("$1,234.56")).toBe(1234.56);
  });

  it("handles negative parentheses", () => {
    expect(parseCurrency("(45.67)")).toBe(-45.67);
  });

  it("returns zero for empty input", () => {
    expect(parseCurrency("")).toBe(0);
  });
});

describe("parseNumber", () => {
  it("returns null for empty values", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });

  it("parses numeric strings with commas", () => {
    expect(parseNumber("1,250")).toBe(1250);
  });
});

describe("parseDate", () => {
  it("parses valid dates and formats to sheet", () => {
    const parsed = parseDate("2024-02-01", "yyyy-MM-dd", "UTC");
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(formatDateForSheet(parsed, "UTC")).toBe("2024-02-01");
    }
  });

  it("returns null for invalid dates", () => {
    expect(parseDate("not-a-date", "yyyy-MM-dd", "UTC")).toBeNull();
  });

  it("falls back to native Date parsing when Utilities.parseDate throws", () => {
    const originalUtilities = (globalThis as { Utilities?: unknown }).Utilities;
    (globalThis as { Utilities?: unknown }).Utilities = {
      parseDate: () => {
        throw new Error("parse failed");
      },
    };

    try {
      const parsed = parseDate("2024-03-10", "yyyy-MM-dd", "UTC");
      expect(parsed).not.toBeNull();
      expect(parseDate("still-bad", "yyyy-MM-dd", "UTC")).toBeNull();
    } finally {
      (globalThis as { Utilities?: unknown }).Utilities = originalUtilities;
    }
  });
});

describe("buildRegex", () => {
  it("returns undefined for empty values", () => {
    expect(buildRegex(" ")).toBeUndefined();
  });

  it("builds case-insensitive regex", () => {
    const regex = buildRegex("coffee");
    expect(regex).toBeInstanceOf(RegExp);
    expect(regex?.test("Coffee Shop")).toBe(true);
  });
});
