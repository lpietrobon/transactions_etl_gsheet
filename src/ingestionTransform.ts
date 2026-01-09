import { generateCompositeKey, normalizeHeader } from "./core";
import { formatDateForSheet, parseCurrency, parseDate } from "./parsing";
import { buildRowFromRecord } from "./sheets";
import type { TransactionRecord } from "./core";

export type CsvConfig = {
  dateFormat: string;
  amountColumn?: string;
  withdrawalColumn?: string;
  depositColumn?: string;
  accountName?: string;
  institution?: string;
  signConvention: "positive_deposit" | "positive_withdrawal";
  columnMap: Record<string, string>;
};

export function computeHeaderHash(headers: string[]): string {
  const normalized = headers.map((header) => normalizeHeader(header));
  const joined = normalized.join("|");
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, joined, Utilities.Charset.UTF_8);
  return digest.map((byte) => (byte + 256).toString(16).slice(-2)).join("");
}

export function mapRowToRecord(
  row: unknown[],
  sourceIndex: Record<string, number>,
  config: CsvConfig,
  sourceFile: string,
  now: Date,
  timeZone: string
): TransactionRecord {
  const mapped: Record<string, string> = {};
  Object.entries(config.columnMap).forEach(([sourceHeader, targetHeader]) => {
    const normalizedSource = normalizeHeader(sourceHeader);
    const index = sourceIndex[normalizedSource];
    mapped[targetHeader] = index !== undefined ? String(row[index] || "") : "";
  });

  const dateValue = mapped["Date"] || "";
  const parsedDate = parseDate(dateValue, config.dateFormat, timeZone) ?? now;
  const formattedDate = formatDateForSheet(parsedDate, timeZone);

  const description = mapped["Description"] || "";
  const type = mapped["Type"] || "";
  const checkNumber = mapped["Check Number"] || "";

  let withdrawal = 0;
  let deposit = 0;

  if (config.withdrawalColumn || config.depositColumn) {
    if (config.withdrawalColumn) {
      const index = sourceIndex[normalizeHeader(config.withdrawalColumn)];
      withdrawal = parseCurrency(String(row[index] || ""));
    }
    if (config.depositColumn) {
      const index = sourceIndex[normalizeHeader(config.depositColumn)];
      deposit = parseCurrency(String(row[index] || ""));
    }
  } else if (config.amountColumn) {
    const index = sourceIndex[normalizeHeader(config.amountColumn)];
    const amount = parseCurrency(String(row[index] || ""));
    if (config.signConvention === "positive_deposit") {
      if (amount >= 0) deposit = amount;
      else withdrawal = Math.abs(amount);
    } else {
      if (amount >= 0) withdrawal = amount;
      else deposit = Math.abs(amount);
    }
  }

  return {
    accountName: config.accountName ?? mapped["Account Name"] ?? "",
    institution: config.institution ?? mapped["Institution"] ?? "",
    date: formattedDate,
    type: type,
    description: description,
    withdrawal: withdrawal,
    deposit: deposit,
    checkNumber: checkNumber,
    category: mapped["Category"] || "",
    sourceFile,
    manualCategory: mapped["Manual Category"] || ""
  };
}

export function buildRowsFromCsvData(params: {
  csvData: unknown[][];
  sourceIndex: Record<string, number>;
  config: CsvConfig;
  sourceFile: string;
  now: Date;
  timeZone: string;
  existingKeys: Set<string>;
  headerRow: string[];
  headerIndex: Record<string, number>;
}): { rowsToAppend: unknown[][]; updatedKeys: Set<string> } {
  const {
    csvData,
    sourceIndex,
    config,
    sourceFile,
    now,
    timeZone,
    existingKeys,
    headerRow,
    headerIndex
  } = params;

  const rowsToAppend: unknown[][] = [];
  const seenKeysInFile = new Set<string>();
  const updatedKeys = new Set(existingKeys);

  for (let i = 1; i < csvData.length; i += 1) {
    const row = csvData[i];
    if (row.every((cell) => String(cell || "").trim() === "")) continue;

    const record = mapRowToRecord(row, sourceIndex, config, sourceFile, now, timeZone);
    const key = generateCompositeKey({
      date: record.date,
      withdrawal: record.withdrawal,
      deposit: record.deposit,
      description: record.description,
      accountName: record.accountName,
      type: record.type
    });

    if (updatedKeys.has(key)) continue;
    if (seenKeysInFile.has(key)) {
      record.description = `[Possible Duplicate] ${record.description}`;
    }
    seenKeysInFile.add(key);

    rowsToAppend.push(buildRowFromRecord(record, headerRow, headerIndex));
    updatedKeys.add(key);
  }

  return { rowsToAppend, updatedKeys };
}
