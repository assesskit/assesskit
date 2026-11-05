import type { XmlElement } from "../xml/index.js";
import type { SupportSetting } from "./settings.js";
import type { PredefinedSupportName, SetSupportName } from "./support-names.js";

/**
 * A candidate's personal needs and preferences in the QTI profile of PNP 3.0.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, PNP}
 */
export interface PersonalNeedsProfile {
  /**
   * The supports the profile assigns, with their settings, in document order. Each key is the `name` of its setting.
   * A support that a set lists but the profile does not assign is not here.
   */
  readonly supports: ReadonlyMap<PredefinedSupportName, SupportSetting>;
  /** The supports to offer as options, which the candidate turns on. */
  readonly activateAsOption: ReadonlySet<SetSupportName>;
  /** The supports to have on from the start of the session. */
  readonly activateAtInitialization: ReadonlySet<SetSupportName>;
  /** The supports the candidate must not have. */
  readonly prohibited: ReadonlySet<SetSupportName>;
  /**
   * Custom supports: the elements of other namespaces that the profile holds, kept as they are. The name of
   * a custom support for catalogs and for the engine is `ext:` and the local name of its element.
   */
  readonly extensions: readonly XmlElement[];
}

/** A person as the system that holds the profile knows them. */
export interface PersonSourcedId {
  /** The system that issued the identifier (`source-system`). */
  readonly sourceSystem: string;
  /** The identifier of the person in that system. */
  readonly id: string;
}

/** A profile in a bulk file, with the candidate and the assessment assignments it is for. */
export interface PnpRecord {
  /** The candidate. */
  readonly personSourcedId: PersonSourcedId;
  /** The assessment assignments the profile is for; none means every assignment of the candidate. */
  readonly appointmentIds: readonly string[];
  /** The profile. */
  readonly profile: PersonalNeedsProfile;
}

/** The states of a support, for the checks. */
export const SUPPORT_STATES = ["prohibited", "active", "option", "assigned"] as const;

/**
 * How a profile treats a support: `prohibited` is not available; `active` is on from the start; `option` is
 * available and off until the candidate turns it on; `assigned` is requested by the profile outside the sets, so the
 * delivery system provides it.
 */
export type SupportState = (typeof SUPPORT_STATES)[number];
