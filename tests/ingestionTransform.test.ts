import { generateCompositeKey } from "../src/core";
import { buildRowsFromCsvData, mapRowToRecord, prepareCsvConfig } from "../src/ingestionTransform";
import type { CsvConfig } from "../src/ingestionTransform";
import { TARGET_SCHEMA } from "../src/config";
import { createHeaderIndex, Table } from "../src/sheets";

describe("prepareCsvConfig", () => {
  it("builds column index mappings and amount indices", () => {
    const headers = ["Date", "Description", "Amount", "Deposit"];
    const sourceIndex = createHeaderIndex(headers);
    const config: CsvConfig = {
      dateFormat: "yyyy-MM-dd",
      amountColumn: "Amount",
      depositColumn: "Deposit",
      signConvention: "positive_deposit",
      columnMap: {
        Date: "Date",
        Description: "Description"
      }
    };

    const prepared = prepareCsvConfig(config, sourceIndex);

    expect(prepared.columnMapIndex).toEqual({
      Date: sourceIndex["date"],
      Description: sourceIndex["description"]
    });
    expect(prepared.amountColumnIndex).toBe(sourceIndex["amount"]);
    expect(prepared.depositColumnIndex).toBe(sourceIndex["deposit"]);
  });
});

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

    const prepared = prepareCsvConfig(config, sourceIndex);

    const record = mapRowToRecord([
      "2024-01-02",
      "Coffee",
      "-12.50"
    ], prepared, "file.csv", new Date("2024-01-03T00:00:00Z"), "UTC");

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

    const prepared = prepareCsvConfig(config, sourceIndex);

    const record = mapRowToRecord([
      "2024-01-02",
      "Refund",
      "-20.00"
    ], prepared, "file.csv", new Date("2024-01-03T00:00:00Z"), "UTC");

    expect(record.withdrawal).toBe(0);
    expect(record.deposit).toBe(20);
  });

  it("maps withdrawal and deposit columns when both are present", () => {
    const headers = ["Date", "Description", "Withdrawal", "Deposit"];
    const sourceIndex = createHeaderIndex(headers);
    const config: CsvConfig = {
      dateFormat: "yyyy-MM-dd",
      withdrawalColumn: "Withdrawal",
      depositColumn: "Deposit",
      signConvention: "positive_deposit",
      columnMap: {
        Date: "Date",
        Description: "Description"
      }
    };

    const prepared = prepareCsvConfig(config, sourceIndex);

    const record = mapRowToRecord([
      "2024-02-10",
      "Payroll",
      "45.25",
      "1500.00"
    ], prepared, "file.csv", new Date("2024-02-11T00:00:00Z"), "UTC");

    expect(record.withdrawal).toBe(45.25);
    expect(record.deposit).toBe(1500);
  });

  it("defaults missing withdrawal/deposit columns to zero", () => {
    const cases = [
      {
        headers: ["Date", "Description", "Withdrawal"],
        config: {
          withdrawalColumn: "Withdrawal"
        },
        row: ["2024-02-12", "ATM", "80.00"],
        expected: { withdrawal: 80, deposit: 0 }
      },
      {
        headers: ["Date", "Description", "Deposit"],
        config: {
          depositColumn: "Deposit"
        },
        row: ["2024-02-12", "Interest", "12.34"],
        expected: { withdrawal: 0, deposit: 12.34 }
      }
    ];

    cases.forEach(({ headers, config, row, expected }) => {
      const sourceIndex = createHeaderIndex(headers);
      const prepared = prepareCsvConfig({
        dateFormat: "yyyy-MM-dd",
        signConvention: "positive_deposit",
        columnMap: {
          Date: "Date",
          Description: "Description"
        },
        ...config
      }, sourceIndex);

      const record = mapRowToRecord(
        row,
        prepared,
        "file.csv",
        new Date("2024-02-13T00:00:00Z"),
        "UTC"
      );

      expect(record.withdrawal).toBe(expected.withdrawal);
      expect(record.deposit).toBe(expected.deposit);
    });
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
    const prepared = prepareCsvConfig(config, sourceIndex);

    const table = new Table(TARGET_SCHEMA);
    const result = buildRowsFromCsvData({
      csvData,
      config: prepared,
      sourceFile: "file.csv",
      now: new Date("2024-01-06T00:00:00Z"),
      timeZone: "UTC",
      existingKeys: new Set(),
      table
    });

    expect(result.rowsToAppend).toHaveLength(2);
    const descriptionIndex = table.headerIndex["description"];
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
    const prepared = prepareCsvConfig(config, sourceIndex);

    const recordKey = generateCompositeKey({
      date: "2024-01-05",
      withdrawal: 5,
      deposit: 0,
      description: "Coffee",
      accountName: "",
      type: ""
    });

    const table = new Table(TARGET_SCHEMA);
    const result = buildRowsFromCsvData({
      csvData,
      config: prepared,
      sourceFile: "file.csv",
      now: new Date("2024-01-06T00:00:00Z"),
      timeZone: "UTC",
      existingKeys: new Set([recordKey]),
      table
    });

    expect(result.rowsToAppend).toHaveLength(0);
  });
});
