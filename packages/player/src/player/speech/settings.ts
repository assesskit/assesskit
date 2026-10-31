import { checkArray, checkRecord } from "@assesskit/runtime/checks";
import type { Spoken } from "@assesskit/runtime/pnp";
import {
  PNP_LINK_INDICATIONS,
  PNP_READING_TYPES,
  PNP_RESTRICTION_TYPES,
  PNP_TYPING_ECHOES,
} from "@assesskit/runtime/pnp";
import { checkSpeechRate, checkTerm, checkUnitInterval } from "./checks.js";

/**
 * What the candidate's spoken support asks for: the fields of the runtime's `Spoken` that decide how content is read.
 *
 * @remarks
 * A `Spoken` is accepted as it is.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, spoken support}
 */
export type SpeechSettings = Partial<
  Pick<Spoken, "readingType" | "restrictionTypes" | "speechRate" | "pitch" | "volume" | "linkIndication" | "typingEcho">
>;

function checkRestrictionType(type: unknown): void {
  if (typeof type === "string" && type.startsWith("ext:")) return;
  checkTerm(
    type,
    PNP_RESTRICTION_TYPES,
    'A restriction type must be a term of the vocabulary or start with "ext:"; it',
  );
}

/**
 * Checks the settings of a spoken support, as a host passes them from JavaScript or JSON.
 *
 * @remarks
 * Absent fields are accepted; `null` is not.
 *
 * @param settings - The value to check.
 * @throws `DataError` when a field has a value outside the PNP vocabulary or range.
 */
export function checkSpeechSettings(settings: unknown): asserts settings is SpeechSettings {
  checkRecord(settings, "The speech settings must be an object");
  const { readingType, restrictionTypes = [], speechRate, pitch, volume, linkIndication, typingEcho } = settings;
  if (readingType !== undefined) checkTerm(readingType, PNP_READING_TYPES, "The reading type");
  checkArray(restrictionTypes, "The restriction types must be an array");
  for (const type of restrictionTypes) checkRestrictionType(type);
  if (speechRate !== undefined) checkSpeechRate(speechRate, "The speech rate");
  if (pitch !== undefined) checkUnitInterval(pitch, "The pitch");
  if (volume !== undefined) checkUnitInterval(volume, "The volume");
  if (linkIndication !== undefined) checkTerm(linkIndication, PNP_LINK_INDICATIONS, "The link indication");
  if (typingEcho !== undefined) checkTerm(typingEcho, PNP_TYPING_ECHOES, "The typing echo");
}

/**
 * Returns the restriction types of settings that were checked.
 *
 * @param settings - The checked settings.
 * @returns The restriction types; none when the settings have none.
 */
export function restrictionsOf(settings: SpeechSettings): ReadonlySet<string> {
  return new Set(settings.restrictionTypes ?? []);
}
