// Generates README sections that mirror the sheet headers defined in src/config.ts.
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const configPath = path.join(repoRoot, "src", "config.ts");
const readmePath = path.join(repoRoot, "README.md");

const START_MARKER = "<!-- CONFIG_HEADERS_START -->";
const END_MARKER = "<!-- CONFIG_HEADERS_END -->";

const readText = (filePath) => fs.readFileSync(filePath, "utf8");

const extractArray = (source, name) => {
  const regex = new RegExp(`export const ${name} = \\[(.*?)\\];`, "s");
  const match = source.match(regex);
  if (!match) {
    throw new Error(`Unable to find ${name} in ${configPath}`);
  }
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
};

const renderList = (items) => items.map((item) => `- \`${item}\``).join("\n");

const renderSection = (targetHeaders, rulesHeaders) => [
  "### Transactions sheet headers",
  "",
  renderList(targetHeaders),
  "",
  "### Rules sheet headers",
  "",
  renderList(rulesHeaders)
].join("\n");

const replaceSection = (readme, replacement) => {
  const startIndex = readme.indexOf(START_MARKER);
  const endIndex = readme.indexOf(END_MARKER);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("README markers missing or out of order.");
  }
  const before = readme.slice(0, startIndex + START_MARKER.length);
  const after = readme.slice(endIndex);
  return `${before}\n${replacement}\n${after}`;
};

const configSource = readText(configPath);
const targetHeaders = extractArray(configSource, "TARGET_SCHEMA");
const rulesHeaders = extractArray(configSource, "RULES_HEADERS");
const readmeSource = readText(readmePath);
const updatedReadme = replaceSection(readmeSource, renderSection(targetHeaders, rulesHeaders));

fs.writeFileSync(readmePath, updatedReadme);
console.log("README header section updated.");
