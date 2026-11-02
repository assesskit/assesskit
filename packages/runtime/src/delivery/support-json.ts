import * as v from "valibot";
import { describe, isRecord, parseWith, type Schema, transformWith } from "../checks.js";
import { DataError } from "../errors.js";
import {
  type Braille,
  type FontFace,
  isSupportName,
  type Magnification,
  type PredefinedSupportName,
  type Spoken,
  SUPPORT_NAMES,
  type SupportName,
  type SupportSetting,
  type SupportState,
  type TextAppearance,
  writePnp,
} from "../pnp/index.js";
import { ADJUSTABLE_SETTINGS } from "./adjustable-settings.js";
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

/** A schema for each property of the settings of a support, so that the compiler finds a property left out. */
type Properties<TSetting> = { readonly [TName in keyof Required<TSetting>]: v.GenericSchema };

/** A parameter of a support, whose value `writePnp` checks. */
const parameter = v.optional(v.unknown());

/** A zoom of magnification, with nothing but its amount. */
const zoom = v.optional(v.strictObject({ zoomAmount: parameter }));

const braille = {
  name: v.literal("braille"),
  replaceAccessModes: parameter,
  language: parameter,
  deliveryMode: parameter,
  grade: parameter,
  brailleType: parameter,
  mathType: parameter,
} satisfies Properties<Braille>;

const magnification = {
  name: v.literal("magnification"),
  replaceAccessModes: parameter,
  allContent: zoom,
  text: zoom,
  nonText: zoom,
} satisfies Properties<Magnification>;

const spoken = {
  name: v.literal("spoken"),
  replaceAccessModes: parameter,
  readingType: parameter,
  restrictionTypes: parameter,
  speechRate: parameter,
  pitch: parameter,
  volume: parameter,
  linkIndication: parameter,
  typingEcho: parameter,
} satisfies Properties<Spoken>;

const textAppearance = {
  name: v.literal("text-appearance"),
  replaceAccessModes: parameter,
  colorTheme: parameter,
  backgroundColor: parameter,
  fontColor: parameter,
  fontSize: parameter,
  fontFace: v.optional(
    v.strictObject({ fontNames: parameter, genericFontFace: parameter } satisfies Properties<FontFace>),
  ),
  lineSpacing: parameter,
  lineHeight: parameter,
  letterSpacing: parameter,
  uniformFontSizing: parameter,
  wordSpacing: parameter,
  wordWrapping: parameter,
} satisfies Properties<TextAppearance>;

/** The supports whose settings a candidate may change, which `ADJUSTABLE_SETTINGS` names. */
const ADJUSTABLE_NAMES: readonly string[] = Object.keys(ADJUSTABLE_SETTINGS);

/**
 * The schema of the settings of a support in an action: those of the support that their `name` names. The settings of a
 * support whose settings the candidate may change hold its parameters and nothing else, nested objects included, so that an
 * action cannot carry other data into the state; the engine refuses the settings of any other support.
 */
export const supportSettingSchema: Schema<SupportSetting> = v.pipe(
  v.variant(
    "name",
    [
      v.strictObject(braille),
      v.strictObject(magnification),
      v.strictObject(spoken),
      v.strictObject(textAppearance),
      v.looseObject({ name: v.picklist(SUPPORT_NAMES.filter((name) => !ADJUSTABLE_NAMES.includes(name))) }),
    ],
    "The name of the settings must be a predefined support.",
  ),
  transformWith((json) => readSupportSetting(json, json.name)),
);

/**
 * Checks the settings of a support, as an action carries them: an object whose `name` is a predefined support and whose
 * parameters `writePnp` accepts for that support, as {@link supportSettingSchema} reads them.
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
  parseWith(supportSettingSchema, value, label);
}

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
