import { readFileSync } from "node:fs";
import { failOnProblems, fieldReader, type Guard, isRecord, isText, listOf, oneOf } from "./read.ts";

/** The evidence codes and what each one means. */
export const EVIDENCE = [
  {
    code: "R",
    meaning:
      "Round trip: models satisfy read(write(m)) = m; documents of the corpus survive read and write unchanged up to canonical form",
  },
  { code: "X", meaning: "Written output validates against the official XSD" },
  { code: "S", meaning: "Unit test whose expected value is a statement or worked example of the cited section" },
  { code: "P", meaning: "Property of the semantics, checked by fast-check" },
  { code: "D", meaning: "Differential test against Longsight qti3-core on items" },
  { code: "C", meaning: "Corpus document read, validated and, where it has processing, executed" },
  { code: "N", meaning: "Negative fixture that must produce the named issue or error" },
  { code: "V", meaning: "Exhaustive vocabulary test: every term accepted, any other term rejected" },
  { code: "U", meaning: "Unit test of data access only, where the specification has no semantics" },
] as const;

/** The tables of the inventory by the letter of their row identifiers. */
export const TABLES = [
  { letter: "A", title: "ASI elements" },
  { letter: "S", title: "Common attributes and extension points" },
  { letter: "H", title: "HTML5 elements" },
  { letter: "M", title: "MathML, SSML, XInclude, PLS and CSS" },
  { letter: "T", title: "Values, base types, cardinalities and built-in variables" },
  { letter: "B", title: "Behaviors" },
  { letter: "W", title: "Vocabularies" },
  { letter: "V", title: "Rule sets of BIND §5" },
  { letter: "K", title: "Content packaging" },
  { letter: "Q", title: "Metadata" },
  { letter: "U", title: "Usage data" },
  { letter: "R", title: "Results Reporting" },
  { letter: "P", title: "PNP" },
  { letter: "C", title: "CAT" },
  { letter: "J", title: "PCI" },
  { letter: "E", title: "Headless delivery engine" },
  { letter: "O", title: "olah conventions, not QTI" },
  { letter: "L", title: "Semantic checks and the validator CLI" },
  { letter: "N", title: "Non-goals" },
  { letter: "G", title: "Spec gaps" },
] as const;

/** Fields every row has. */
interface RowBase {
  /** The table letter and the number, such as `A79`; tests name it in brackets. */
  readonly id: string;
  /** What the row is about, in Markdown. */
  readonly construct: string;
  /** The specification reference that defines it, when there is one. */
  readonly source?: string;
}

/** A row olah implements: it needs a test once its unit is merged. */
export interface ScopedRow extends RowBase {
  /** The olah modules that implement it. */
  readonly modules: readonly string[];
  /** How it is evidenced: codes of the scheme of the inventory. */
  readonly evidence: readonly string[];
  /** The build unit whose merge completes the evidence. */
  readonly unit: string;
}

/** A row olah does not implement: it names the system that owns the construct. */
export interface OutOfScopeRow extends RowBase {
  /** The kind of system that owns it. */
  readonly owner: string;
}

/** One row of the inventory. */
export type InventoryRow = ScopedRow | OutOfScopeRow;

/** The inventory of `conformance/olah-inventory.json`. */
export interface Inventory {
  /** Every build unit, in the order of the build plan. */
  readonly units: readonly string[];
  /** The units merged so far; only their rows need tests. */
  readonly merged: readonly string[];
  /** Every row. */
  readonly rows: readonly InventoryRow[];
}

/** Returns whether a row is one olah implements. */
export function isScoped(row: InventoryRow): row is ScopedRow {
  return "unit" in row;
}

/** What an inventory file may use: the letters that start its row identifiers and the codes of its evidence. */
export interface InventoryScheme {
  /** The letters of the tables. */
  readonly letters: readonly string[];
  /** The codes of the evidence a row may name. */
  readonly evidence: readonly string[];
}

/** The scheme of `olah-inventory.json`. */
const OLAH_SCHEME: InventoryScheme = {
  letters: TABLES.map(({ letter }) => letter),
  evidence: EVIDENCE.map(({ code }) => code),
};

const ROW_ID = /^([A-Z])[1-9]\d*$/;

const isTextList: Guard<readonly string[]> = (value): value is readonly string[] =>
  listOf(isText)(value) && value.length > 0;

/** Reads one row, adding what is wrong with it to `problems`. */
function parseRow(
  value: unknown,
  index: number,
  scheme: InventoryScheme,
  isUnit: Guard<string>,
  problems: string[],
): InventoryRow | undefined {
  if (!isRecord(value)) {
    problems.push(`rows[${index}] is not an object.`);
    return undefined;
  }
  const isRowId: Guard<string> = (candidate): candidate is string =>
    typeof candidate === "string" && scheme.letters.includes(ROW_ID.exec(candidate)?.[1] ?? "");
  const isEvidenceList: Guard<readonly string[]> = (candidate): candidate is readonly string[] =>
    listOf(oneOf(scheme.evidence))(candidate) && candidate.length > 0;
  const read = fieldReader(typeof value.id === "string" ? value.id : `rows[${index}]`, value, problems);
  const id = read.required("id", isRowId, "the letter of a table and a number");
  const construct = read.required("construct", isText, "a non-empty string");
  const source = read.optional("source", isText, "a non-empty string");
  const base =
    id !== undefined && construct !== undefined ? { id, construct, ...(source ? { source } : {}) } : undefined;
  if (value.owner !== undefined) {
    const owner = read.required("owner", isText, "a non-empty string");
    read.absent(["modules", "evidence", "unit"], "as the row is out of scope");
    return base && owner ? { ...base, owner } : undefined;
  }
  const modules = read.required("modules", isTextList, "a non-empty array of strings");
  const evidence = read.required("evidence", isEvidenceList, `a non-empty array of ${scheme.evidence.join(", ")}`);
  const unit = read.required("unit", isUnit, "one of the units");
  return base && modules && evidence && unit ? { ...base, modules, evidence, unit } : undefined;
}

/** Checks the shape of the inventory and returns it typed; its rows use the letters and evidence of the scheme. */
export function parseInventory(data: unknown, scheme: InventoryScheme = OLAH_SCHEME): Inventory {
  const isStrings = listOf(isText);
  if (!(isRecord(data) && isStrings(data.units) && isStrings(data.merged) && Array.isArray(data.rows))) {
    throw new Error("The inventory must be an object with the arrays units, merged and rows.");
  }
  const { units, merged } = data;
  const problems: string[] = [];
  for (const unit of merged) if (!units.includes(unit)) problems.push(`merged: ${unit} is not one of the units.`);
  const isUnit = oneOf(units);
  const rows: InventoryRow[] = [];
  const ids = new Set<string>();
  data.rows.forEach((value: unknown, index) => {
    const row = parseRow(value, index, scheme, isUnit, problems);
    if (row === undefined) return;
    if (ids.has(row.id)) problems.push(`${row.id}: the id occurs twice.`);
    ids.add(row.id);
    rows.push(row);
  });
  failOnProblems("The inventory", problems);
  return { units, merged, rows };
}

/** Reads and checks the inventory file. */
export function loadInventory(path: string, scheme: InventoryScheme = OLAH_SCHEME): Inventory {
  return parseInventory(JSON.parse(readFileSync(path, "utf8")), scheme);
}
