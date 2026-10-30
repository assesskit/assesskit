import type { XmlNode } from "@luthfanwakan/olah/xml";
import { isRecord } from "../../checks.js";
import { ssmlElement } from "./ssml.js";

/** The values a property may have: the terms listed, or any string when `true`. */
type Values = readonly string[] | true;

/**
 * The functions of `data-ssml` and the properties of each, with the values they may have (DSSML §2.4, §3.4.5). A value of
 * `true` is any string. `emphasis` is not in DSSML, but the example of BPIG §5.2.1.8 uses it with the `level` of SSML 1.1
 * §3.2.1; `prosody` has `rate` only.
 */
const FUNCTIONS: ReadonlyMap<string, ReadonlyMap<string, Values>> = new Map<string, ReadonlyMap<string, Values>>([
  [
    "break",
    new Map<string, Values>([
      ["strength", ["none", "x-weak", "weak", "medium", "strong", "x-strong"]],
      ["time", true],
    ]),
  ],
  ["emphasis", new Map<string, Values>([["level", ["strong", "moderate", "none", "reduced"]]])],
  [
    "phoneme",
    new Map<string, Values>([
      ["ph", true],
      ["alphabet", ["ipa", "x-sampa"]],
      ["type", ["default", "ruby"]],
    ]),
  ],
  ["prosody", new Map<string, Values>([["rate", true]])],
  [
    "say-as",
    new Map<string, Values>([["interpret-as", ["date", "time", "telephone", "characters", "cardinal", "ordinal"]]]),
  ],
  ["sub", new Map<string, Values>([["alias", true]])],
]);

/** The properties each function needs (DSSML §3.4.5: `ph`, `interpret-as` and `alias`). */
const REQUIRED: ReadonlyMap<string, string> = new Map([
  ["phoneme", "ph"],
  ["say-as", "interpret-as"],
  ["sub", "alias"],
]);

/** The labels of a speaking rate (SSML 1.1 §3.2.4). */
const RATE_LABELS: readonly string[] = ["x-slow", "slow", "medium", "fast", "x-fast", "default"];

/** A rate as a percentage, with or without a sign (SSML 1.1 §3.2.4). */
const RATE_PERCENT = /^[+-]?\d+(?:\.\d+)?%$/u;

/** The functions that hold text only (SSML 1.1 §3.1.9, §3.1.10, §3.1.11). */
const TEXT_FUNCTIONS: ReadonlySet<string> = new Set(["phoneme", "say-as", "sub"]);

/**
 * The functions of `data-ssml` from the outermost to the innermost, so that a value with several nests the same way
 * whatever its order. `break` is empty and comes before the content.
 */
const NESTING: readonly string[] = ["prosody", "emphasis", "say-as", "phoneme", "sub"];

/** The functions of one `data-ssml` value that are valid, by name, each with its properties. */
export type DataSsml = ReadonlyMap<string, Readonly<Record<string, string>>>;

/** Returns whether a rate is a label or a percentage of SSML 1.1 §3.2.4. */
const isRate = (rate: string | undefined): boolean =>
  rate !== undefined && (RATE_LABELS.includes(rate) || RATE_PERCENT.test(rate));

/** Reads the properties of one function, or returns `undefined` when one is not defined, has a value outside its terms, or is missing. */
function readProperties(
  allowed: ReadonlyMap<string, Values>,
  value: Readonly<Record<string, unknown>>,
): Record<string, string> | undefined {
  const properties: Record<string, string> = {};
  for (const [property, text] of Object.entries(value)) {
    const values = allowed.get(property);
    if (values === undefined || typeof text !== "string") return undefined;
    if (values !== true && !values.includes(text)) return undefined;
    properties[property] = text;
  }
  return properties;
}

function readFunction(name: string, value: unknown): Record<string, string> | undefined {
  const allowed = FUNCTIONS.get(name);
  if (allowed === undefined || !isRecord(value)) return undefined;
  const properties = readProperties(allowed, value);
  const required = REQUIRED.get(name);
  if (properties === undefined || (required !== undefined && properties[required] === undefined)) return undefined;
  return name === "prosody" && !isRate(properties.rate) ? undefined : properties;
}

/**
 * Reads the value of a `data-ssml` attribute: a JSON object with the functions `break`, `emphasis`, `phoneme`, `prosody`,
 * `say-as` and `sub` (DSSML §3.1). Content must not hold what DSSML does not define (DSSML §4.2), so a value that is not
 * JSON, not an object, or has an unknown function, property or value has no effect: `undefined`, and the element is read
 * as it is.
 */
export function readDataSsml(value: string): DataSsml | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const functions = new Map<string, Record<string, string>>();
  for (const [name, properties] of Object.entries(parsed)) {
    const read = readFunction(name, properties);
    if (read === undefined) return undefined;
    functions.set(name, read);
  }
  return functions.size === 0 ? undefined : functions;
}

/**
 * Wraps the content of an element in the SSML its `data-ssml` asks for.
 *
 * @param data - The functions that {@link readDataSsml} read.
 * @param text - The text of the element, for the functions that hold text only (`phoneme`, `say-as` and `sub`).
 * @param content - The content as it is read, for the others.
 */
export function applyDataSsml(data: DataSsml, text: string, content: readonly XmlNode[]): readonly XmlNode[] {
  let nodes: readonly XmlNode[] = content;
  for (const name of [...NESTING].reverse()) {
    const properties = data.get(name);
    if (properties === undefined) continue;
    nodes = [ssmlElement(name, properties, TEXT_FUNCTIONS.has(name) ? [text] : nodes)];
  }
  const pause = data.get("break");
  return pause === undefined ? nodes : [ssmlElement("break", pause, []), ...nodes];
}
