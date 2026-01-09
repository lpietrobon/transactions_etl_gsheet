import { CONFIGS_BY_HEADER_HASH, SHEETS, TARGET_SCHEMA } from "./config";
import { normalizeHeaders } from "./core";
import { sendAlert } from "./alerts";
import { buildRowsFromCsvData, computeHeaderHash, prepareCsvConfig } from "./ingestionTransform";
import { getConfigValue, getRequiredConfigValue } from "./configSheet";
import {
  buildExistingKeys,
  createHeaderIndex,
  ensureSheetWithHeaders
} from "./sheets";

const CONFIG_KEYS = {
  rawFolderId: "RAW_FOLDER_ID",
  archiveFolderId: "ARCHIVE_FOLDER_ID"
};

export function ingestCSVs(): void {
  const rawFolderId = getRequiredConfigValue(CONFIG_KEYS.rawFolderId);
  const folder = DriveApp.getFolderById(rawFolderId);
  const files = folder.getFiles();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const transactionSheet = ensureSheetWithHeaders(spreadsheet, SHEETS.transactions, TARGET_SCHEMA);

  const headerRow = transactionSheet.getRange(1, 1, 1, transactionSheet.getLastColumn()).getValues()[0];
  const headerIndex = createHeaderIndex(headerRow);
  let existingKeys = buildExistingKeys(transactionSheet, headerRow);

  const rowsToAppend: unknown[][] = [];
  const now = new Date();
  const timeZone = Session.getScriptTimeZone();

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    const isCsv = name.toLowerCase().endsWith(".csv") || file.getMimeType() === MimeType.CSV;
    if (!isCsv) continue;

    try {
      const blob = file.getBlob();
      const csvData = Utilities.parseCsv(blob.getDataAsString());
      if (csvData.length < 2) continue;

      const rawHeaders = csvData[0].map((header) => String(header || ""));
      const normalizedHeaders = normalizeHeaders(rawHeaders);
      const headerHash = computeHeaderHash(normalizedHeaders);
      const config = CONFIGS_BY_HEADER_HASH[headerHash];

      if (!config) {
        sendAlert(
          `Unknown CSV header hash for file ${name}.`,
          `Header hash: ${headerHash}\nHeaders: ${rawHeaders.join(", ")}`
        );
        continue;
      }

      const sourceIndex = createHeaderIndex(rawHeaders);
      const preparedConfig = prepareCsvConfig(config, sourceIndex);
      const { rowsToAppend: newRows, updatedKeys } = buildRowsFromCsvData({
        csvData,
        config: preparedConfig,
        sourceFile: name,
        now,
        timeZone,
        existingKeys,
        headerRow,
        headerIndex
      });

      rowsToAppend.push(...newRows);
      existingKeys = updatedKeys;

      archiveFileIfConfigured(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendAlert(`Failed ingestion for file ${name}.`, message);
    }
  }

  if (rowsToAppend.length > 0) {
    const startRow = transactionSheet.getLastRow() + 1;
    transactionSheet.getRange(startRow, 1, rowsToAppend.length, headerRow.length).setValues(rowsToAppend);
  }
}

function archiveFileIfConfigured(file: GoogleAppsScript.Drive.File): void {
  const archiveFolderId = getConfigValue(CONFIG_KEYS.archiveFolderId);
  if (!archiveFolderId) return;
  const archiveFolder = DriveApp.getFolderById(archiveFolderId);
  archiveFolder.addFile(file);
  const parents = file.getParents();
  while (parents.hasNext()) {
    const parent = parents.next();
    if (parent.getId() !== archiveFolderId) {
      parent.removeFile(file);
    }
  }
}
