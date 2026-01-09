export type TransactionRecord = {
  accountName: string;
  institution: string;
  date: string;
  type: string;
  description: string;
  withdrawal: number;
  deposit: number;
  checkNumber: string;
  category: string;
  sourceFile: string;
  manualCategory: string;
};

export type Rule = {
  id: string;
  enabled: boolean;
  category: string;
  descriptionRegex?: RegExp;
  accountRegex?: RegExp;
  typeRegex?: RegExp;
  minAmount?: number;
  maxAmount?: number;
};

export const normalizeHeader = (header: string): string =>
  header.trim().toLowerCase().replace(/\s+/g, " ");

export const normalizeHeaders = (headers: string[]): string[] =>
  headers.map(normalizeHeader);

export const normalizeWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

export const formatAmount = (amount: number): string =>
  Number.isFinite(amount) ? amount.toFixed(2) : "0.00";

export const generateCompositeKey = (input: {
  date: string;
  withdrawal: number;
  deposit: number;
  description: string;
  accountName: string;
  type: string;
}): string => {
  const normalized = [
    input.date,
    formatAmount(input.withdrawal),
    formatAmount(input.deposit),
    normalizeWhitespace(input.description).toLowerCase(),
    normalizeWhitespace(input.accountName).toLowerCase(),
    normalizeWhitespace(input.type).toLowerCase()
  ];
  return normalized.join("|");
};

export const ruleMatches = (rule: Rule, record: TransactionRecord): boolean => {
  if (!rule.enabled) return false;
  if (record.manualCategory) return false;
  if (rule.descriptionRegex && !rule.descriptionRegex.test(record.description)) return false;
  if (rule.accountRegex && !rule.accountRegex.test(record.accountName)) return false;
  if (rule.typeRegex && !rule.typeRegex.test(record.type)) return false;
  const amount = record.deposit > 0 ? record.deposit : record.withdrawal * -1;
  if (rule.minAmount !== undefined && amount < rule.minAmount) return false;
  if (rule.maxAmount !== undefined && amount > rule.maxAmount) return false;
  return true;
};
