import { checkArray, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { buildElement, serializeXml, type XmlElement } from "../xml/index.js";
import type { PersonalNeedsProfile, PnpRecord } from "./model.js";
import { PNP_NAMESPACE, PNP_SCHEMA_LOCATION } from "./namespace.js";
import { checkProfile, SET_ELEMENTS } from "./profile-checks.js";
import { writeSupport } from "./write-supports.js";

const SCHEMA_LOCATION = { "xsi:schemaLocation": `${PNP_NAMESPACE} ${PNP_SCHEMA_LOCATION}` };

const element = (
  name: string,
  attributes: Readonly<Record<string, string | undefined>> = {},
  children: readonly (XmlElement | string)[] = [],
): XmlElement => buildElement(PNP_NAMESPACE, name, attributes, children);

function profileElement(profile: PersonalNeedsProfile, attributes: Readonly<Record<string, string>> = {}): XmlElement {
  checkProfile(profile);
  const supports = [...profile.supports].flatMap(([name, setting]) => {
    checkRecord(setting, `The settings of the support ${name} must be an object`);
    if (setting.name !== name) {
      throw new DataError(
        `The support under the key ${describe(name)} has the name ${describe(setting.name)}; they must be the same.`,
      );
    }
    return writeSupport(setting);
  });
  const sets = SET_ELEMENTS.flatMap(([elementName, field]) =>
    profile[field].size === 0
      ? []
      : [
          element(
            elementName,
            {},
            [...profile[field]].map((name) => element(name)),
          ),
        ],
  );
  return element("access-for-all-pnp", attributes, [...supports, ...sets, ...profile.extensions]);
}

function recordElement(record: PnpRecord): XmlElement {
  checkRecord(record, "A PNP record must be an object");
  const { personSourcedId, appointmentIds } = record;
  checkRecord(personSourcedId, "The personSourcedId of a PNP record must be an object");
  const ids = checkIdentifiers(appointmentIds);
  const sourcedId = element(
    "person-sourced-id",
    { "source-system": text(personSourcedId.sourceSystem, "The sourceSystem of a person") },
    [text(personSourcedId.id, "The id of a person")],
  );
  return element("access-for-all-pnp-record", {}, [sourcedId, ...ids, profileElement(record.profile)]);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new DataError(`${label} must be a string, found ${describe(value)}.`);
  return value;
}

function checkIdentifiers(ids: readonly string[]): XmlElement[] {
  checkArray(ids, "The appointmentIds of a PNP record must be an array");
  return ids.map((id) => element("appointment-id", {}, [text(id, "An appointment id")]));
}

/** `Array.isArray` does not narrow a read-only array out of a union. */
const isRecords = (value: PersonalNeedsProfile | readonly PnpRecord[]): value is readonly PnpRecord[] =>
  Array.isArray(value);

/**
 * Writes a PNP document of the QTI profile of PNP 3.0 in UTF-8, valid against the PNP schema, which names it in
 * `xsi:schemaLocation`, and always in the schema's namespace. Supports are written in the order of the profile, then the
 * non-empty sets, then the custom supports. A profile gives `access-for-all-pnp`; an array of records gives the bulk file
 * `access-for-all-pnp-records`.
 *
 * @param profile - A profile, or one or more records; it is checked deeply.
 * @returns The document.
 * @throws `DataError` when the model is not one: a field of the wrong type, a key that differs from the name of its
 * setting, a name that no set can list, a parameter outside its vocabulary, an empty list of records, or text with a
 * character that XML 1.0 does not allow.
 */
export function writePnp(profile: PersonalNeedsProfile | readonly PnpRecord[]): string {
  if (isRecords(profile)) {
    if (profile.length === 0) throw new DataError("A bulk PNP file needs at least one record.");
    return serializeXml(element("access-for-all-pnp-records", SCHEMA_LOCATION, profile.map(recordElement)));
  }
  return serializeXml(profileElement(profile, SCHEMA_LOCATION));
}
