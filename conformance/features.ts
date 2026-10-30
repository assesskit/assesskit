import { readFileSync } from "node:fs";
import { failOnProblems, fieldReader, isRecord, isText, listOf, oneOf } from "./read.ts";

/** The certification levels of CERT §2.1 and §3; a feature in none of them is elective. */
export const LEVELS = [
  { id: "basic", title: "Basic" },
  { id: "advanced", title: "Advanced" },
  { id: "elevated-accessibility", title: "Elevated Accessibility" },
  { id: "pnp", title: "PNP" },
] as const;

/** The areas of CERT Appendix A. */
export const GROUPS = [
  { id: "tests", title: "Tests" },
  { id: "sections", title: "Sections" },
  { id: "items", title: "Items" },
  { id: "interactions", title: "Interactions" },
  { id: "accessibility", title: "Accessibility" },
  { id: "metadata", title: "Metadata" },
  { id: "packaging", title: "Packaging" },
] as const;

/** The capabilities of CERT §2.2 that olah and tempuh can offer. */
const CAPABILITIES = ["import", "export", "authoring", "delivery", "scoring"] as const;

/** Which package supports a feature. */
const OWNERS = ["olah", "tempuh", "both"] as const;

/** A certification level. */
type Level = (typeof LEVELS)[number]["id"];
/** An area of the feature list. */
type Group = (typeof GROUPS)[number]["id"];
/** A capability of an application. */
type Capability = (typeof CAPABILITIES)[number];
/** The package that supports a feature. */
type Owner = (typeof OWNERS)[number];

/** A feature of CERT Appendix A and what olah and tempuh do about it. */
export interface CertFeature {
  /** The identifier in Appendix A, such as `T-4`. */
  readonly id: string;
  /** The feature name. */
  readonly name: string;
  /** The area. */
  readonly group: Group;
  /** The levels that require it; none for an elective feature. */
  readonly levels: readonly Level[];
  /** The capabilities for which the product supports it; absent until mapped. */
  readonly capabilities?: readonly Capability[];
  /** The package that supports it; absent until mapped. */
  readonly owner?: Owner;
  /** The inventory rows that implement it; absent until mapped. */
  readonly rows?: readonly string[];
}

const isLevel = oneOf(LEVELS.map(({ id }) => id));
const isGroup = oneOf(GROUPS.map(({ id }) => id));
const isCapability = oneOf(CAPABILITIES);
const isOwner = oneOf(OWNERS);

/** Reads one feature, adding what is wrong with it to `problems`. */
function parseFeature(
  value: unknown,
  index: number,
  rows: ReadonlySet<string>,
  problems: string[],
): CertFeature | undefined {
  if (!isRecord(value)) {
    problems.push(`features[${index}] is not an object.`);
    return undefined;
  }
  const read = fieldReader(typeof value.id === "string" ? value.id : `features[${index}]`, value, problems);
  const id = read.required("id", isText, "a non-empty string");
  const name = read.required("name", isText, "a non-empty string");
  const group = read.required("group", isGroup, `one of ${GROUPS.map(({ id }) => id).join(", ")}`);
  const levels = read.required("levels", listOf(isLevel), `an array of ${LEVELS.map(({ id }) => id).join(", ")}`);
  const capabilities = read.optional("capabilities", listOf(isCapability), `an array of ${CAPABILITIES.join(", ")}`);
  const owner = read.optional("owner", isOwner, `one of ${OWNERS.join(", ")}`);
  const mapped = read.optional(
    "rows",
    listOf((row): row is string => typeof row === "string" && rows.has(row)),
    "an array of inventory row identifiers",
  );
  if (id === undefined || name === undefined || group === undefined || levels === undefined) return undefined;
  return {
    id,
    name,
    group,
    levels,
    ...(capabilities ? { capabilities } : {}),
    ...(owner ? { owner } : {}),
    ...(mapped ? { rows: mapped } : {}),
  };
}

/**
 * Reads and checks the feature list.
 *
 * @param path - The feature file.
 * @param rows - The identifiers of the inventory rows that features may name.
 */
export function loadFeatures(path: string, rows: ReadonlySet<string>): CertFeature[] {
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!(isRecord(data) && Array.isArray(data.features))) {
    throw new Error("The feature list must be an object with the array features.");
  }
  const problems: string[] = [];
  const features: CertFeature[] = [];
  const ids = new Set<string>();
  data.features.forEach((value: unknown, index) => {
    const feature = parseFeature(value, index, rows, problems);
    if (feature === undefined) return;
    if (ids.has(feature.id)) problems.push(`${feature.id}: the id occurs twice.`);
    ids.add(feature.id);
    features.push(feature);
  });
  failOnProblems("The feature list", problems);
  return features;
}
