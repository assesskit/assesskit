import type { XmlElement } from "../xml/index.js";
import { ElementReader, type ReaderRules } from "../xml/internal.js";
import type { PersonalNeedsProfile, PersonSourcedId, PnpRecord } from "./model.js";
import { PNP_ALTERNATE_NAMESPACES, PNP_NAMESPACE } from "./namespace.js";
import { SET_ELEMENTS } from "./profile-checks.js";
import { readSupport } from "./read-supports.js";
import type { SupportSetting } from "./settings.js";
import {
  isPredefinedSupportName,
  isSetSupportName,
  type PredefinedSupportName,
  type SetSupportName,
} from "./support-names.js";

const RULES: ReaderRules = {
  module: "pnp",
  namespaces: [PNP_NAMESPACE, ...PNP_ALTERNATE_NAMESPACES],
};

/** Reads the members of a set: each is an empty element named after a support that a set can list. */
function readSet(reader: ElementReader): Set<SetSupportName> {
  const names = new Set<SetSupportName>();
  for (let child = reader.next(); child !== undefined; child = reader.next()) {
    if (child.foreign || !isSetSupportName(child.name)) {
      const message = `The element ${child.qualifiedName} cannot be listed in the set ${reader.name}: a set lists predefined supports other than hazard-avoidance and environment.`;
      throw child.fail("unexpected-element", message);
    }
    child.done();
    if (names.has(child.name))
      throw child.fail("repeated-element", `The set ${reader.name} lists ${child.name} twice.`);
    names.add(child.name);
  }
  reader.done();
  return names;
}

/**
 * Joins a second element of a support to the first. Only `hazard-avoidance` and `language-of-interface` occur once for
 * each hazard and each language; any other repeat gives `undefined`.
 */
function join(first: SupportSetting, second: SupportSetting): SupportSetting | undefined {
  if (first.name === "hazard-avoidance" && second.name === "hazard-avoidance") {
    return { name: first.name, hazards: [...first.hazards, ...second.hazards] };
  }
  if (first.name === "language-of-interface" && second.name === "language-of-interface") {
    return { name: first.name, languages: [...first.languages, ...second.languages] };
  }
  return undefined;
}

function addSupport(
  supports: Map<PredefinedSupportName, SupportSetting>,
  child: ElementReader,
  name: PredefinedSupportName,
): void {
  const setting = readSupport(child, name);
  const first = supports.get(name);
  const joined = first === undefined ? setting : join(first, setting);
  if (joined === undefined) {
    throw child.fail("repeated-element", `The support ${name} occurs more than once; the schema allows it once.`);
  }
  supports.set(name, joined);
}

/** The sets of a profile by the name of their elements. */
const SET_FIELDS: ReadonlyMap<string, (typeof SET_ELEMENTS)[number][1]> = new Map(SET_ELEMENTS);

/** What a profile holds while its children are read. */
interface ProfileParts {
  readonly supports: Map<PredefinedSupportName, SupportSetting>;
  readonly sets: Readonly<Record<(typeof SET_ELEMENTS)[number][1], Set<SetSupportName>>>;
  readonly extensions: XmlElement[];
  readonly setsRead: Set<string>;
}

function addSet(parts: ProfileParts, child: ElementReader, field: (typeof SET_ELEMENTS)[number][1]): void {
  if (parts.setsRead.has(child.name)) {
    throw child.fail("repeated-element", `The set ${child.name} occurs more than once; the schema allows it once.`);
  }
  parts.setsRead.add(child.name);
  for (const name of readSet(child)) parts.sets[field].add(name);
}

/** Reads one child of a profile: a support, a set, or an extension. The schema lets them come in any order. */
function readMember(parts: ProfileParts, child: ElementReader): void {
  if (child.foreign) {
    parts.extensions.push(child.extension());
    return;
  }
  const field = SET_FIELDS.get(child.name);
  if (field !== undefined) {
    addSet(parts, child, field);
  } else if (isPredefinedSupportName(child.name)) {
    addSupport(parts.supports, child, child.name);
  } else {
    throw child.fail(
      "unexpected-element",
      `The element ${child.qualifiedName} is neither a predefined support nor a set.`,
    );
  }
}

function readProfile(reader: ElementReader): PersonalNeedsProfile {
  const parts: ProfileParts = {
    supports: new Map(),
    sets: { activateAtInitialization: new Set(), activateAsOption: new Set(), prohibited: new Set() },
    extensions: [],
    setsRead: new Set(),
  };
  for (let child = reader.next(); child !== undefined; child = reader.next()) readMember(parts, child);
  reader.done();
  return { supports: parts.supports, ...parts.sets, extensions: parts.extensions };
}

function readText(reader: ElementReader): string {
  const text = reader.text();
  reader.done();
  return text;
}

function readPersonSourcedId(reader: ElementReader): PersonSourcedId {
  const sourceSystem = reader.required("source-system");
  return { sourceSystem, id: readText(reader) };
}

function readRecord(reader: ElementReader): PnpRecord {
  const personSourcedId = readPersonSourcedId(reader.require("person-sourced-id"));
  const appointmentIds = reader.takeAll("appointment-id").map(readText);
  const profile = readProfile(reader.require("access-for-all-pnp"));
  reader.done();
  return { personSourcedId, appointmentIds, profile };
}

/**
 * Reads a PNP document of the QTI profile of PNP 3.0: a single profile, `access-for-all-pnp`, or a bulk file of
 * profiles, `access-for-all-pnp-records`.
 *
 * @remarks
 * The reader also accepts the two namespaces that 1EdTech's own documents use instead of the schema's;
 * {@link PNP_ALTERNATE_NAMESPACES} lists them. A support may occur once; the exceptions are `hazard-avoidance` and
 * `language-of-interface`, which occur once for each hazard and each language. A set lists predefined supports only; an
 * element of another namespace is a custom support only as a child of the profile.
 *
 * @param input - The document as text or bytes, or the root element of a parsed document.
 * @returns A profile for `access-for-all-pnp`, the records for `access-for-all-pnp-records`.
 * @throws `DataError` when `input` is none of these.
 * @throws `ReadError` when the document is not well-formed, the root is neither of the two, or the document cannot be
 * mapped to the model: an unknown, repeated or misplaced element, a parameter outside its vocabulary, a number that is not
 * one, or a missing `xml:lang` or `source-system`.
 * @throws `SecurityError` when the text or bytes break a limit of `parseXml`.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, PNP}
 */
export function readPnp(input: string | Uint8Array | XmlElement): PersonalNeedsProfile | readonly PnpRecord[] {
  const reader = ElementReader.open(input, RULES, "The PNP");
  if (!reader.foreign && reader.name === "access-for-all-pnp") return readProfile(reader);
  if (reader.foreign || reader.name !== "access-for-all-pnp-records") {
    const message = `The root element must be access-for-all-pnp or access-for-all-pnp-records in the namespace ${PNP_NAMESPACE}, found ${reader.qualifiedName}.`;
    throw reader.fail("not-pnp", message);
  }
  const records = reader.takeAll("access-for-all-pnp-record").map(readRecord);
  if (records.length === 0) {
    throw reader.fail("missing-element", "The element access-for-all-pnp-records needs an access-for-all-pnp-record.");
  }
  reader.done();
  return records;
}
