export const SHEETS = {
  transactions: "Transactions",
  rules: "Rules",
  config: "Config"
};

export const TARGET_SCHEMA = [
  "Account Name",
  "Institution",
  "Date",
  "Type",
  "Description",
  "Withdrawal",
  "Deposit",
  "Check Number",
  "Category",
  "Source File",
  "Manual Category",
  "Category by Rule",
  "Matched Rule ID"
];

export const HEADER_KEYS = {
  accountName: "account name",
  institution: "institution",
  date: "date",
  type: "type",
  description: "description",
  withdrawal: "withdrawal",
  deposit: "deposit",
  checkNumber: "check number",
  category: "category",
  sourceFile: "source file",
  manualCategory: "manual category",
  categoryByRule: "category by rule",
  matchedRuleId: "matched rule id"
};

export const RULES_HEADERS = [
  "Rule ID",
  "ON",
  "Category",
  "Description Regex",
  "Account Regex",
  "Type Regex",
  "Min Amount",
  "Max Amount"
];

export type AmountSignConvention = "positive_deposit" | "positive_withdrawal";

export type SourceConfig = {
  headerHash: string;
  dateFormat: string;
  amountColumn?: string;
  withdrawalColumn?: string;
  depositColumn?: string;
  accountName?: string;
  institution?: string;
  signConvention: AmountSignConvention;
  columnMap: Record<string, string>;
};

export const CONFIGS_BY_HEADER_HASH: Record<string, SourceConfig> = {
  // Example entry (replace with your actual header hash + mappings)
  // "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855": {
  //   headerHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  //   dateFormat: "MM/dd/yyyy",
  //   amountColumn: "Amount",
  //   signConvention: "positive_deposit",
  //   accountName: "Checking",
  //   institution: "Example Bank",
  //   columnMap: {
  //     "Date": "Date",
  //     "Description": "Description",
  //     "Type": "Type",
  //     "Amount": "Amount",
  //     "Check Number": "Check Number"
  //   }
  // }
};

export const DEFAULT_ALERT_SUBJECT = "Transactions ETL Alert";
