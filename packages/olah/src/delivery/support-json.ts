import { checkBoolean, checkChoice, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import {
  type PredefinedSupportName,
  SUPPORT_NAMES,
  type SupportSetting,
  type SupportState,
  writePnp,
} from "../pnp/index.js";
import type { SessionSupport } from "./delivery-state.js";

/** The states of a support, for the checks. */
const SUPPORT_STATES: readonly SupportState[] = ["prohibited", "active", "option", "assigned"];

/**
 * Reads the settings of a support from JSON: an object whose `name` is the support's and whose parameters `writePnp` accepts
 * for that support.
 *
 * @throws `DataError` when the settings are not those of a predefined support of that name.
 */
function readSupportSetting(json: unknown, name: string): SupportSetting {
  checkRecord(json, `The settings of the support ${describe(name)} must be an object`);
  const predefined: PredefinedSupportName | undefined = SUPPORT_NAMES.find((known) => known === name);
  if (predefined === undefined || json.name !== name) {
    throw new DataError(
      `The settings of the support ${describe(name)} must name a predefined support and have the name ${describe(name)}, found ${describe(json.name)}.`,
    );
  }
  // The cast is checked at once: writePnp reads every parameter of the setting and throws when one does not fit.
  const setting = json as unknown as SupportSetting;
  writePnp({
    supports: new Map([[predefined, setting]]),
    activateAsOption: new Set(),
    activateAtInitialization: new Set(),
    prohibited: new Set(),
    extensions: [],
  });
  return setting;
}

/**
 * Reads the state of a support session from JSON: its state, whether it is on, and its settings when it has any.
 *
 * @throws `DataError` when it is not one.
 */
export function readSessionSupport(json: unknown, name: string): SessionSupport {
  checkRecord(json, `The support ${describe(name)} must be an object`);
  checkChoice(json.state, `The state of the support ${describe(name)}`, SUPPORT_STATES);
  checkBoolean(json.active, `The active of the support ${describe(name)}`);
  if (json.universal !== undefined && json.universal !== true) {
    throw new DataError(
      `The universal of the support ${describe(name)} must be true, found ${describe(json.universal)}.`,
    );
  }
  return {
    state: json.state,
    active: json.active,
    ...(json.settings === undefined ? {} : { settings: readSupportSetting(json.settings, name) }),
    ...(json.universal === undefined ? {} : { universal: true as const }),
  };
}
