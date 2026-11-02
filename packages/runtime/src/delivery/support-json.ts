import * as v from "valibot";
import { describe, isRecord, type Schema, transformWith } from "../checks.js";
import { DataError } from "../errors.js";
import {
  isSupportName,
  type PredefinedSupportName,
  SUPPORT_NAMES,
  type SupportName,
  type SupportSetting,
  type SupportState,
  writePnp,
} from "../pnp/index.js";
import type { SupportView } from "./candidate-view.js";
import type { SessionSupport } from "./delivery-state.js";
import { entriesSchema } from "./entries-json.js";

/** The states of a support, for the checks. */
const SUPPORT_STATES: readonly SupportState[] = ["prohibited", "active", "option", "assigned"];

/** The schema of the name of a support: a predefined one, or `ext:` and at least one character. */
export const supportNameSchema: Schema<SupportName> = v.custom<SupportName>(
  isSupportName,
  "The name of a support must be the name of a support of a PNP.",
);

/**
 * Checks the settings of a support: an object whose `name` is the support's and whose parameters `writePnp` accepts for
 * that support.
 *
 * @throws `DataError` when the settings are not those of a predefined support of that name.
 */
function readSupportSetting(json: unknown, name: string): SupportSetting {
  const predefined: PredefinedSupportName | undefined = SUPPORT_NAMES.find((known) => known === name);
  if (predefined === undefined || !isRecord(json) || json.name !== name) {
    const found = isRecord(json) ? json.name : json;
    throw new DataError(
      `The settings of the support ${describe(name)} must name a predefined support and have the name ${describe(name)}, found ${describe(found)}.`,
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
 * Checks the settings of a support, as an action carries them: an object whose `name` is a predefined support and whose
 * parameters `writePnp` accepts for that support.
 *
 * @param value - The value to check.
 * @param label - Names the value in the message, such as `The settings of support-settings`.
 * @throws `DataError` when it is not the settings of a predefined support.
 */
export function checkSupportSetting(value: unknown, label: string): asserts value is SupportSetting {
  const name = isRecord(value) ? value.name : undefined;
  if (typeof name !== "string" || !SUPPORT_NAMES.some((known) => known === name)) {
    throw new DataError(
      `${label} must be an object whose name is a predefined support, found ${describe(isRecord(value) ? name : value)}.`,
    );
  }
  readSupportSetting(value, name);
}

/** The schema of the settings of a support in an action: those of the support that their `name` names. */
export const supportSettingSchema: Schema<SupportSetting> = v.pipe(
  v.looseObject({ name: v.picklist(SUPPORT_NAMES, "The name of the settings must be a predefined support.") }),
  transformWith((json) => readSupportSetting(json, json.name)),
);

/** The schema of a support in a view; its settings are those of its name. */
export const supportViewSchema: Schema<SupportView> = v.pipe(
  v.strictObject({
    name: supportNameSchema,
    state: v.picklist(SUPPORT_STATES),
    active: v.boolean(),
    settings: v.optional(v.unknown()),
  }),
  transformWith(({ name, state, active, settings }) => ({
    name,
    state,
    active,
    ...(settings === undefined ? {} : { settings: readSupportSetting(settings, name) }),
  })),
);

const sessionSupportSchema = v.object({
  state: v.picklist(SUPPORT_STATES),
  active: v.boolean(),
  settings: v.optional(v.unknown()),
  universal: v.optional(v.literal(true)),
});

/** The schema of the supports of a state, by name; the settings of each are those of its name. */
export const supportsSchema: Schema<Map<SupportName, SessionSupport>> = v.pipe(
  entriesSchema(sessionSupportSchema),
  transformWith((entries) => {
    const supports = new Map<SupportName, SessionSupport>();
    for (const [name, { state, active, settings, universal }] of entries) {
      if (!isSupportName(name)) {
        throw new DataError(`A support of the state must have a support name, found ${describe(name)}.`);
      }
      supports.set(name, {
        state,
        active,
        ...(settings === undefined ? {} : { settings: readSupportSetting(settings, name) }),
        ...(universal === undefined ? {} : { universal }),
      });
    }
    return supports;
  }),
);
