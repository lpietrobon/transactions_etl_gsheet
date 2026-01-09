// Tests for core normalization helpers and rule matching.
import { generateCompositeKey, normalizeHeader, normalizeHeaders, ruleMatches } from "../src/core";
import type { Rule, TransactionRecord } from "../src/core";

describe("generateCompositeKey", () => {
  it("normalizes whitespace and casing", () => {
    const key = generateCompositeKey({
      date: "2024-01-01",
      withdrawal: 12.5,
      deposit: 0,
      description: "  Coffee   Shop ",
      accountName: "Checking",
      type: "CARD"
    });

    expect(key).toBe("2024-01-01|12.50|0.00|coffee shop|checking|card");
  });

  it("stabilizes amounts to two decimals", () => {
    const key = generateCompositeKey({
      date: "2024-01-02",
      withdrawal: 3,
      deposit: 4.1,
      description: "Vendor",
      accountName: "Savings",
      type: "ACH"
    });

    expect(key).toBe("2024-01-02|3.00|4.10|vendor|savings|ach");
  });
});

describe("normalizeHeader", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeHeader("  Account   Name ")).toBe("account name");
  });
});

describe("normalizeHeaders", () => {
  it("normalizes an array of headers", () => {
    expect(normalizeHeaders(["  Date ", "Description"])).toEqual([
      "date",
      "description"
    ]);
  });
});

describe("ruleMatches", () => {
  const baseRecord: TransactionRecord = {
    accountName: "Checking",
    institution: "Bank",
    date: "2024-01-01",
    type: "Card",
    description: "Coffee Shop",
    withdrawal: 5,
    deposit: 0,
    checkNumber: "",
    category: "",
    sourceFile: "file.csv",
    manualCategory: ""
  };

  it("returns false when rule is disabled", () => {
    const rule: Rule = {
      id: "R1",
      enabled: false,
      category: "Food"
    };

    expect(ruleMatches(rule, baseRecord)).toBe(false);
  });

  it("respects manual category override", () => {
    const rule: Rule = {
      id: "R1",
      enabled: true,
      category: "Food"
    };

    expect(ruleMatches(rule, { ...baseRecord, manualCategory: "Manual" })).toBe(false);
  });

  it("matches based on regex and amount range", () => {
    const rule: Rule = {
      id: "R2",
      enabled: true,
      category: "Coffee",
      descriptionRegex: /coffee/i,
      minAmount: -10,
      maxAmount: 0
    };

    expect(ruleMatches(rule, baseRecord)).toBe(true);
  });

  it("fails when account regex does not match", () => {
    const rule: Rule = {
      id: "R3",
      enabled: true,
      category: "Coffee",
      accountRegex: /savings/i
    };

    expect(ruleMatches(rule, baseRecord)).toBe(false);
  });
});
