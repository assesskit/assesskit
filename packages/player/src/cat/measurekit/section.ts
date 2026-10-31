import type { SectionData } from "@assesskit/runtime/cat";
import { DataError } from "@assesskit/runtime/errors";
import { decodeBase64 } from "@assesskit/runtime/values";
import * as v from "valibot";
import {
  describe,
  finiteSchema,
  mapSchema,
  nonEmptyStringSchema,
  parseWith,
  positiveIntegerSchema,
} from "../../checks.js";
import { readSectionData } from "../section-data.js";
import type { StoredAdaptiveSection, StoredItem, StoredModule, StoredPanelSection } from "./section-store.js";
import { readItems } from "./usage.js";

/** A section read from its data, with the identifier under which the store keeps it. */
export interface ReadSection<TSection> {
  /** The content-addressed identifier of the section. */
  readonly identifier: string;
  /** The section. */
  readonly section: TSection;
}

/** The files of a section, parsed. */
interface SectionParts {
  readonly identifier: string;
  readonly data: SectionData;
  readonly settings: unknown;
  readonly items: readonly StoredItem[];
}

const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, "0")).join("");
}

/** Decodes the base64 text of a file of the section data (CAT §4.1) to its bytes. */
function readFile(encoded: string, label: string): Uint8Array {
  const bytes = decodeBase64(encoded);
  if (bytes === undefined) throw new DataError(`${label} must be base64 text (RFC 4648), found text that is not.`);
  return bytes;
}

/** Reads a file of the section data as UTF-8 JSON. */
function readJson(encoded: string, label: string): unknown {
  const bytes = readFile(encoded, label);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DataError(`${label} must be UTF-8 text, found bytes that are not.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DataError(`${label} must be JSON text, found text that is not.`);
  }
}

/**
 * Returns the content-addressed identifier of section data: the SHA-256, in lowercase hexadecimal, of the UTF-8 JSON array
 * of `sectionConfiguration`, `qtiUsagedata` and `qtiMetadata`, with `null` for a field that is absent. Equal section data
 * has one identifier in every process and every deployment (CAT §3.1 leaves the identifier to the engine).
 */
export async function sectionIdentifier(data: SectionData): Promise<string> {
  const { sectionConfiguration, qtiUsagedata = null, qtiMetadata = null } = data;
  const text = JSON.stringify([sectionConfiguration, qtiUsagedata, qtiMetadata]);
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

async function readParts(input: unknown): Promise<SectionParts> {
  const data = readSectionData(input);
  const { sectionConfiguration, qtiUsagedata } = data;
  return {
    identifier: await sectionIdentifier(data),
    data,
    settings: readJson(sectionConfiguration, "The sectionConfiguration of the section data"),
    items: qtiUsagedata === undefined ? [] : readItems(readFile(qtiUsagedata, "The qtiUsagedata of the section data")),
  };
}

// The areas of the content targets are data, `__proto__` included, so they are read into a map.
const adaptiveSettingsSchema = v.strictObject({
  length: positiveIntegerSchema,
  contentTargets: v.optional(mapSchema(finiteSchema), () => new Map<string, number>()),
  enemies: v.optional(v.array(v.array(nonEmptyStringSchema)), []),
});

/**
 * Reads the section data of an item-level adaptive section. The settings file is JSON `{ length, contentTargets,
 * enemies }`: the length of the test, the target proportion of each content area, and the sets of items that must not
 * appear together; the last two are optional. The usage data gives the parameters of the items.
 *
 * @throws `DataError` when the data is not section data, the settings are not that JSON, or the usage data has an invalid
 * parameter.
 * @throws `ReadError` and `SecurityError` as `readUsageData` does for a usage data file that cannot be read.
 */
export async function readAdaptiveSection(data: unknown): Promise<ReadSection<StoredAdaptiveSection>> {
  const { identifier, data: sectionData, settings, items } = await readParts(data);
  const { length, contentTargets, enemies } = parseWith(
    adaptiveSettingsSchema,
    settings,
    "The settings of an adaptive section",
  );
  return {
    identifier,
    section: {
      kind: "adaptive",
      data: sectionData,
      items,
      length,
      contentTargets: [...contentTargets],
      enemies,
    },
  };
}

const panelSettingsSchema = v.strictObject({
  stages: v.array(
    v.strictObject({
      modules: v.array(v.strictObject({ id: nonEmptyStringSchema, items: v.array(nonEmptyStringSchema) })),
    }),
  ),
});

/**
 * Reads the section data of a multistage panel. The settings file is JSON `{ stages: [{ modules: [{ id, items }] }] }`:
 * the modules of each stage and the identifiers of their items. The usage data gives the parameters of the items, which
 * every module must find there.
 *
 * @throws `DataError` when the data is not section data, the settings are not that JSON, the usage data has an invalid
 * parameter, or a module lists an item that the usage data has no parameters for.
 * @throws `ReadError` and `SecurityError` as `readUsageData` does for a usage data file that cannot be read.
 */
export async function readPanelSection(data: unknown): Promise<ReadSection<StoredPanelSection>> {
  const { identifier, data: sectionData, settings, items } = await readParts(data);
  const stages = parseWith(panelSettingsSchema, settings, "The settings of a panel").stages.map(
    ({ modules }): readonly StoredModule[] => modules,
  );
  const known = new Set(items.map(({ id }) => id));
  for (const { id, items: listed } of stages.flat()) {
    const missing = listed.find((item) => !known.has(item));
    if (missing !== undefined) {
      throw new DataError(
        `The module ${describe(id)} lists the item ${describe(missing)}, which the usage data gives no parameters for.`,
      );
    }
  }
  return { identifier, section: { kind: "panel", data: sectionData, items, stages } };
}
