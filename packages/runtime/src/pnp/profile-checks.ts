import { checkArray, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { XmlElement } from "../xml/index.js";
import type { PersonalNeedsProfile } from "./model.js";
import { PNP_NAMESPACE } from "./namespace.js";
import { isPredefinedSupportName, isSetSupportName } from "./support-names.js";

/** The sets of a profile with the names of their elements, in the order the schema lists them (PNP XSD). */
export const SET_ELEMENTS = [
  ["activate-at-initialization-set", "activateAtInitialization"],
  ["activate-as-option-set", "activateAsOption"],
  ["prohibit-set", "prohibited"],
] as const;

/**
 * Checks the elements that a schema wildcard lets a profile carry: elements of a namespace other than the profile's.
 *
 * @throws `DataError` when `value` is not an array of such elements.
 */
function checkExtensions(value: readonly XmlElement[]): void {
  checkArray(value, "The extensions of a profile must be an array");
  for (const extension of value) {
    checkRecord(extension, "The extensions of a profile must hold elements");
    if (extension.kind !== "element" || extension.namespace === "" || extension.namespace === PNP_NAMESPACE) {
      throw new DataError(
        `The extensions of a profile must hold elements of a namespace other than the PNP namespace, found ${describe(extension)}.`,
      );
    }
  }
}

/**
 * Checks the structure of a profile: its fields, the names of its supports and of the members of its sets, and its
 * extensions. The settings of the supports are checked where they are written.
 *
 * @throws `DataError` when a field has the wrong type or a name is not one of the predefined supports.
 */
export function checkProfile(profile: PersonalNeedsProfile): void {
  checkRecord(profile, "A profile must be an object");
  if (!(profile.supports instanceof Map)) {
    throw new DataError(`The supports of a profile must be a Map, found ${describe(profile.supports)}.`);
  }
  for (const name of profile.supports.keys()) {
    if (!isPredefinedSupportName(name)) {
      throw new DataError(`The supports of a profile are named as predefined supports, found ${describe(name)}.`);
    }
  }
  for (const [, field] of SET_ELEMENTS) {
    const set = profile[field];
    if (!(set instanceof Set)) throw new DataError(`The ${field} of a profile must be a Set, found ${describe(set)}.`);
    for (const name of set) {
      if (!isSetSupportName(name)) {
        throw new DataError(
          `The ${field} of a profile lists predefined supports that a set can hold, found ${describe(name)}.`,
        );
      }
    }
  }
  checkExtensions(profile.extensions);
}
