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
