import { readFileSync } from "node:fs";
import { type Coverage, checkCoverage, type TestReference } from "./coverage.ts";
import { type Inventory, type InventoryScheme, parseInventory } from "./inventory.ts";
import { failOnProblems, fieldReader, isRecord, isText, oneOf } from "./read.ts";

/** The scheme of `player-inventory.json`: rows `T1` to `T122`, and the evidence codes that docs/evidence.md of the player lists. */
export const PLAYER_SCHEME: InventoryScheme = {
  letters: ["T"],
  evidence: ["R", "A", "E", "X", "U", "F", "P", "L"],
};

/** A success criterion of WCAG 2.2 at level A or AA, and how the player evidences it. */
interface Criterion {
  /** The number of the criterion, such as `1.4.3`; tests name it as `[SC 1.4.3]`. */
  readonly id: string;
  /** The name in WCAG 2.2. */
  readonly name: string;
  /** The level. */
  readonly level: "A" | "AA";
  /** What the player does about it, and what is the item author's duty. */
  readonly part: string;
  /** The evidence the design names. */
  readonly evidence: string;
  /** The build unit whose merge completes the evidence; absent when the criterion does not apply. */
  readonly unit?: string;
  /** The manual check by a person that evidences the criterion in place of a test. */
  readonly manual?: string;
  /** Why the criterion does not apply to the player. */
  readonly notApplicable?: string;
}

/** `player-inventory.json`: the rows and the criteria. */
export interface PlayerInventory {
  /** The units, the merged ones and the rows. */
  readonly inventory: Inventory;
  /** The WCAG 2.2 A and AA criteria. */
  readonly criteria: readonly Criterion[];
}

/** What the tests cover and miss, for rows and criteria. */
export interface PlayerCoverage extends Coverage {
  /** The criteria of merged units that no test names and no manual check evidences. */
  readonly missingCriteria: readonly string[];
  /** The criteria that tests name and the inventory does not have. */
  readonly unknownCriteria: readonly { readonly criterion: string; readonly file: string }[];
}

const CRITERION_ID = /^\d\.\d\.\d{1,2}$/;
const RUNTIME_ROW = /^([A-Z])(\d+)(?:–[A-Z](\d+))?$/;

/** Expands the runtime rows a player row cites: `J4–J6` gives `J4`, `J5` and `J6`. Returns `undefined` for another shape. */
function expandRows(text: string): string[] | undefined {
  const match = RUNTIME_ROW.exec(text);
  if (!match) return undefined;
  const [, letter = "", from = "0", to = from] = match;
  return Array.from({ length: Number(to) - Number(from) + 1 }, (_, i) => `${letter}${Number(from) + i}`);
}

/** Checks that one cited row, or range of rows, exists in the runtime's inventory. */
function checkCitation(label: string, cited: string, runtimeRows: ReadonlySet<string>, problems: string[]): void {
  const expanded = expandRows(cited);
  if (expanded === undefined) {
    problems.push(`${label}: the runtime has ${cited}, which is not a row or a range of rows.`);
    return;
  }
  for (const id of expanded) {
    if (!runtimeRows.has(id))
      problems.push(`${label}: the runtime has ${id}, which is not in the runtime's inventory.`);
  }
}

/** Checks that every row cites rows that the runtime's inventory has. */
function citedRows(data: readonly unknown[], runtimeRows: ReadonlySet<string>, problems: string[]): void {
  for (const row of data) {
    if (!isRecord(row)) continue;
    const label = typeof row.id === "string" ? row.id : "a row";
    if (Array.isArray(row.runtime) && row.runtime.every(isText)) {
      for (const cited of row.runtime) checkCitation(label, cited, runtimeRows, problems);
    } else {
      problems.push(`${label}: runtime should be an array of the runtime's rows, empty for none.`);
    }
  }
}

/** Reads one criterion, adding what is wrong with it to `problems`. */
function parseCriterion(
  value: unknown,
  index: number,
  units: readonly string[],
  problems: string[],
): Criterion | undefined {
  if (!isRecord(value)) {
    problems.push(`criteria[${index}] is not an object.`);
    return undefined;
  }
  const isId = (candidate: unknown): candidate is string =>
    typeof candidate === "string" && CRITERION_ID.test(candidate);
  const read = fieldReader(typeof value.id === "string" ? value.id : `criteria[${index}]`, value, problems);
  const id = read.required("id", isId, "the number of a success criterion, such as 1.4.3");
  const name = read.required("name", isText, "a non-empty string");
  const level = read.required("level", oneOf(["A", "AA"] as const), "A or AA");
  const part = read.required("part", isText, "a non-empty string");
  const evidence = read.required("evidence", isText, "a non-empty string");
  const base = id && name && level && part && evidence ? { id, name, level, part, evidence } : undefined;
  if (value.notApplicable !== undefined) {
    const notApplicable = read.required("notApplicable", isText, "a non-empty string");
    read.absent(["unit", "manual"], "as the criterion does not apply");
    return base && notApplicable ? { ...base, notApplicable } : undefined;
  }
  const unit = read.required("unit", oneOf(units), "one of the units");
  const manual = read.optional("manual", isText, "a non-empty string");
  return base && unit ? { ...base, unit, ...(manual ? { manual } : {}) } : undefined;
}

/** Reads the criteria, adding what is wrong with them to `problems`. */
function parseCriteria(data: unknown, units: readonly string[], problems: string[]): Criterion[] {
  if (!Array.isArray(data)) {
    problems.push("criteria should be an array.");
    return [];
  }
  const criteria: Criterion[] = [];
  data.forEach((value: unknown, index) => {
    const criterion = parseCriterion(value, index, units, problems);
    if (criterion === undefined) return;
    if (criteria.some(({ id }) => id === criterion.id)) problems.push(`${criterion.id}: the id occurs twice.`);
    criteria.push(criterion);
  });
  return criteria;
}

/**
 * Reads and checks `player-inventory.json`.
 *
 * @param runtimeRows - The identifiers of the runtime's inventory, which the rows cite.
 */
export function loadPlayerInventory(path: string, runtimeRows: ReadonlySet<string>): PlayerInventory {
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  const inventory = parseInventory(data, PLAYER_SCHEME);
  const problems: string[] = [];
  if (isRecord(data)) {
    citedRows(Array.isArray(data.rows) ? data.rows : [], runtimeRows, problems);
  }
  const criteria = parseCriteria(isRecord(data) ? data.criteria : undefined, inventory.units, problems);
  failOnProblems("The player inventory", problems);
  return { inventory, criteria };
}

/** Compares what tests name with the rows and criteria: those of a merged unit need a test, or a manual check. */
export function checkPlayerCoverage(
  { inventory, criteria }: PlayerInventory,
  references: readonly TestReference[],
): PlayerCoverage {
  const { missing, unknown } = checkCoverage(inventory, references);
  const named = new Set(references.flatMap((reference) => reference.criteria));
  const known = new Set(criteria.map((criterion) => criterion.id));
  const merged = new Set(inventory.merged);
  const missingCriteria = criteria
    .filter(({ id, unit, manual }) => unit !== undefined && merged.has(unit) && manual === undefined && !named.has(id))
    .map(({ id }) => id);
  const unknownCriteria = references.flatMap(({ file, criteria: tagged }) =>
    tagged.filter((criterion) => !known.has(criterion)).map((criterion) => ({ criterion, file })),
  );
  return { missing, unknown, missingCriteria, unknownCriteria };
}
