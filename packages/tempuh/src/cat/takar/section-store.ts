import type { SectionData } from "@luthfanwakan/olah/cat";
import { checkRecord, describe } from "../../checks.js";
import { DataError } from "../../errors.js";

/**
 * The parameters of one item of the usage data, as the item bank states them: the discrimination `a`, the difficulty
 * `b`, the lower asymptote `c` and the upper asymptote `d` of a logistic item (UD §2.8.2). `a` is not yet multiplied by
 * the scaling constant, because a section is shared by every deployment that has its section data.
 */
export interface StoredItem {
  /** The identifier of the item. */
  readonly id: string;
  /** The discrimination, `A-Param`. */
  readonly a: number;
  /** The difficulty, `B-Param`. */
  readonly b: number;
  /** The lower asymptote, `C-Param`. */
  readonly c: number;
  /** The upper asymptote, `D-Param`. */
  readonly d: number;
}

/** The part of a stored section that both kinds share. */
interface StoredSectionBase {
  /** The section data that Create Section received, which Get Section returns. */
  readonly data: SectionData;
  /** The items that the usage data gives parameters for, in the order of the usage data. */
  readonly items: readonly StoredItem[];
}

/** A section of an item-level adaptive test, read from a settings file `{ length, contentTargets, enemies }`. */
export interface StoredAdaptiveSection extends StoredSectionBase {
  /** Tells the two kinds of section apart. */
  readonly kind: "adaptive";
  /** The number of items after which the test ends. */
  readonly length: number;
  /** The target proportion of each content area, as pairs of the area and the proportion; empty without content balancing. */
  readonly contentTargets: readonly (readonly [area: string, target: number])[];
  /** The enemy sets: identifiers of items that must not appear in one test. */
  readonly enemies: readonly (readonly string[])[];
}

/** A module of a stored panel. */
export interface StoredModule {
  /** The identifier of the module. */
  readonly id: string;
  /** The identifiers of the items of the module, in the order in which they are presented. */
  readonly items: readonly string[];
}

/** A section of a multistage panel, read from a settings file `{ stages: [{ modules: [{ id, items }] }] }`. */
export interface StoredPanelSection extends StoredSectionBase {
  /** Tells the two kinds of section apart. */
  readonly kind: "panel";
  /** The stages in order, each a list of modules. */
  readonly stages: readonly (readonly StoredModule[])[];
}

/**
 * A section as the host's {@link SectionStore} keeps it: plain data that JSON serializes, so that a database can hold it.
 * It is the parse of the section data, kept so that a request need not parse the files again.
 */
export type StoredSection = StoredAdaptiveSection | StoredPanelSection;

/**
 * The host's storage of parsed sections. A section is stored under a content-addressed identifier, so every process of the
 * host reads the same section, and storing the same section data again changes nothing. The host prunes it by its own
 * retention: `endSection` of the ports keeps the section, because other deployments with the same section data share it.
 */
export interface SectionStore {
  /** Stores a section under its identifier, replacing the section that is there. */
  put(identifier: string, section: StoredSection): Promise<void>;
  /** Returns the section with the identifier, or `undefined` when the store has none. */
  get(identifier: string): Promise<StoredSection | undefined>;
}

/**
 * Checks a section store, as a host passes it from JavaScript.
 *
 * @param label - Names the store in the error message, such as `The option sections`.
 * @throws `DataError` when it is not an object with the methods `put` and `get`.
 */
export function checkSectionStore(value: unknown, label: string): asserts value is SectionStore {
  checkRecord(value, `${label} must be an object with the methods put and get`);
  if (typeof value.put !== "function" || typeof value.get !== "function") {
    throw new DataError(`${label} must be an object with the methods put and get, found ${describe(value)}.`);
  }
}

/** Returns whether a stored section is of a kind. */
function isKind<TKind extends StoredSection["kind"]>(
  section: StoredSection,
  kind: TKind,
): section is Extract<StoredSection, { readonly kind: TKind }> {
  return section.kind === kind;
}

/**
 * Returns the stored section of the kind that a port reads.
 *
 * @throws `DataError` when the store has no section with the identifier, or the section is of another kind.
 */
export async function loadSection<TKind extends StoredSection["kind"]>(
  store: SectionStore,
  identifier: string,
  kind: TKind,
): Promise<Extract<StoredSection, { readonly kind: TKind }>> {
  const section = await store.get(identifier);
  if (section === undefined) {
    throw new DataError(
      `The section store has no section ${describe(identifier)}; create it with createSection before the first session.`,
    );
  }
  checkRecord(section, `The section ${describe(identifier)} in the section store must be an object`);
  if (!isKind(section, kind)) {
    throw new DataError(
      `The section ${describe(identifier)} is a ${describe(section.kind)} section, and this port reads ${describe(kind)} sections.`,
    );
  }
  return section;
}
