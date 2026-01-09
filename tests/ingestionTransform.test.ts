import { generateCompositeKey } from "../src/core";
import { buildRowsFromCsvData, mapRowToRecord } from "../src/ingestionTransform";
import type { CsvConfig } from "../src/ingestionTransform";
import { TARGET_SCHEMA } from "../src/config";
import { createHeaderIndex } from "../src/sheets";

describe("mapRowToRecord", () => {
  it("maps amounts using positive_deposit convention", () => {
    const headers = ["Date", "Description", "Amount"];
    const sourceIndex = createHeaderIndex(headers);
    const config: CsvConfig = {
      dateFormat: "yyyy-MM-dd",
      amountColumn: "Amount",
      signConvention: "positive_deposit",
      columnMap: {
        Date: "Date",
        Description: "Description"
      }
    };

    const record = mapRowToRecord([
      "2024-01-02",
      "Coffee",
      "-12.50"
    ], sourceIndex, config, "file.csv", new Date("2024-01-03T00:00:00Z"), "UTC");

    expect(record.withdrawal).toBe(12.5);
    expect(record.deposit).toBe(0);
    expect(record.date).toBe("2024-01-02");
  });

  it("maps amounts using positive_withdrawal convention", () => {
    const headers = ["Date", "Description", "Amount"];
    const sourceIndex = createHeaderIndex(headers);
    const config: CsvConfig = {
      dateFormat: "yyyy-MM-dd",
      amountColumn: "Amount",
      signConvention: "positive_withdrawal",
      columnMap: {
        Date: "Date",
        Description: "Description"
      }
    };

    const record = mapRowToRecord([
      "2024-01-02",
      "Refund",
      "-20.00"
    ], sourceIndex, config, "file.csv", new Date("2024-01-03T00:00:00Z"), "UTC");

    expect(record.withdrawal).toBe(0);
    expect(record.deposit).toBe(20);
  });
});

describe("buildRowsFromCsvData", () => {
  it("flags possible duplicates within a file", () => {
    const csvData = [
      ["Date", "Description", "Amount"],
      ["2024-01-05", "Coffee", "-5.00"],
      ["2024-01-05", "Coffee", "-5.00"]
    ];
    const sourceIndex = createHeaderIndex(csvData[0] as string[]);
    const config: CsvConfig = {
      dateFormat: "yyyy-MM-dd",
      amountColumn: "Amount",
      signConvention: "positive_deposit",
      columnMap: {
        Date: "Date",
        Description: "Description"
      }
    };

    const headerIndex = createHeaderIndex(TARGET_SCHEMA);
    const result = buildRowsFromCsvData({
      csvData,
      sourceIndex,
      config,
      sourceFile: "file.csv",
      now: new Date("2024-01-06T00:00:00Z"),
      timeZone: "UTC",
      existingKeys: new Set(),
      headerRow: TARGET_SCHEMA,
      headerIndex
    });

    expect(result.rowsToAppend).toHaveLength(2);
    const descriptionIndex = headerIndex["description"];
    expect(result.rowsToAppend[1][descriptionIndex]).toContain("[Possible Duplicate]");
  });

  it("skips rows that already exist", () => {
    const csvData = [
      ["Date", "Description", "Amount"],
      ["2024-01-05", "Coffee", "-5.00"]
    ];
    const sourceIndex = createHeaderIndex(csvData[0] as string[]);
    const config: CsvConfig = {
      dateFormat: "yyyy-MM-dd",
      amountColumn: "Amount",
      signConvention: "positive_deposit",
      columnMap: {
        Date: "Date",
        Description: "Description"
      }
    };

    const recordKey = generateCompositeKey({
      date: "2024-01-05",
      withdrawal: 5,
      deposit: 0,
      description: "Coffee",
      accountName: "",
      type: ""
    });

    const headerIndex = createHeaderIndex(TARGET_SCHEMA);
    const result = buildRowsFromCsvData({
      csvData,
      sourceIndex,
      config,
      sourceFile: "file.csv",
      now: new Date("2024-01-06T00:00:00Z"),
      timeZone: "UTC",
      existingKeys: new Set([recordKey]),
      headerRow: TARGET_SCHEMA,
      headerIndex
    });

    expect(result.rowsToAppend).toHaveLength(0);
  });
});
