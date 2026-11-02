import type { SupportView } from "@assesskit/runtime/delivery";
import type {
  ColorTheme,
  LinkIndication,
  Magnification,
  Spoken,
  SupportName,
  SupportSetting,
  TextAppearance,
  TypingEcho,
  Zoom,
} from "@assesskit/runtime/pnp";
import type { Messages } from "../../messages/index.js";
import { html } from "../internal.js";
import { DEFAULT_ZOOM } from "./appearance.js";

/** A value of a list as the `value` of its option, and the text that names it. */
type Choice = readonly [value: string, text: string];

/** A setting in force that the candidate changes with a list. */
interface Field {
  /** Names the list among those of its support. */
  readonly key: string;
  /** The label of the list. */
  readonly label: string;
  /** The values offered, in order. */
  readonly choices: readonly Choice[];
  /** The value in force, or `undefined` when the settings leave it to the player or the voice. */
  readonly value: string | undefined;
  /** Returns the text of a value that is not among the choices, such as one of the profile. */
  readonly text: (value: string) => string;
  /** Returns the settings whole with the value that the candidate chose, or `undefined` for a value the list cannot hold. */
  readonly choose: (value: string) => SupportSetting | undefined;
}

/** What the fields need of the panel. */
interface FieldContext {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface, a BCP 47 tag, for the numbers. */
  readonly language: string;
}

/**
 * The amounts of magnification offered, from none to 400 percent, which the candidate must be able to reach.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, magnification}
 */
const ZOOM_AMOUNTS: readonly number[] = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];

/** The speech rates offered, in words per minute; the Web Speech voice reads 180 at its own rate. */
const SPEECH_RATES: readonly number[] = [100, 120, 150, 180, 210, 240, 300];

/** The pitches offered, from 0 to 1 as the PNP gives them, 0.5 being the voice's own. */
const PITCHES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

/** The volumes offered, from 0 to 1 as the PNP gives them. */
const VOLUMES: readonly number[] = [0.25, 0.5, 0.75, 1];

/** The prefix of a term of a program, which a list names by what follows it. */
const EXTENSION_PREFIX = "ext:";

/** Names a term of a program by what follows `ext:`. */
const termText = (value: string): string =>
  value.startsWith(EXTENSION_PREFIX) ? value.slice(EXTENSION_PREFIX.length) : value;

/** Returns the formatter of a percentage in the language of the interface: 1.5 is 150%. */
function percent(language: string): (value: number) => string {
  const format = new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 });
  return (value) => format.format(value);
}

/**
 * Returns the list of a setting whose values are terms, each named by a message; a term of the profile that the list lacks,
 * such as one of a program, is offered too.
 */
function termField<TTerm extends string>(
  key: string,
  label: string,
  { messages }: FieldContext,
  named: readonly (readonly [TTerm, keyof Messages])[],
  current: TTerm | undefined,
  set: (term: TTerm) => SupportSetting,
): Field {
  return {
    key,
    label,
    choices: named.map(([term, message]) => [term, messages[message]]),
    value: current,
    text: termText,
    choose: (value) => {
      const term = value === current ? current : named.find(([known]) => known === value)?.[0];
      return term === undefined ? undefined : set(term);
    },
  };
}

/** Returns the list of a setting whose values are numbers, formatted in the language of the interface. */
function numberField(
  key: string,
  label: string,
  values: readonly number[],
  current: number | undefined,
  format: (value: number) => string,
  set: (value: number) => SupportSetting | undefined,
): Field {
  return {
    key,
    label,
    choices: values.map((value) => [String(value), format(value)]),
    value: current === undefined ? undefined : String(current),
    text: (value) => format(Number(value)),
    choose: (value) => set(Number(value)),
  };
}

/**
 * The message that names each term of `color-theme`, in the order of the list: the themes of the interface, then the pairs
 * of colors.
 */
const THEMES: readonly (readonly [ColorTheme, keyof Messages])[] = [
  ["default", "colorThemeDefault"],
  ["default-reverse", "colorThemeDefaultReverse"],
  ["high-contrast", "colorThemeHighContrast"],
  ["high-contrast-reverse", "colorThemeHighContrastReverse"],
  ["yellow-blue", "colorThemeYellowBlue"],
  ["blue-yellow", "colorThemeBlueYellow"],
  ["black-rose", "colorThemeBlackRose"],
  ["rose-black", "colorThemeRoseBlack"],
  ["black-cyan", "colorThemeBlackCyan"],
  ["cyan-black", "colorThemeCyanBlack"],
  ["black-cream", "colorThemeBlackCream"],
  ["cream-black", "colorThemeCreamBlack"],
  ["medgray-darkgray", "colorThemeMedgrayDarkgray"],
  ["darkgray-medgray", "colorThemeDarkgrayMedgray"],
];

/**
 * The list of the color theme, which the candidate can change at any time and set back to the default colors.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, color-theme}
 */
function textAppearanceFields(settings: TextAppearance, context: FieldContext): Field[] {
  const { messages } = context;
  return [
    termField("color-theme", messages.colorTheme, context, THEMES, settings.colorTheme, (colorTheme) => ({
      ...settings,
      colorTheme,
    })),
  ];
}

/**
 * The lists of the amount of magnification: one for all content, or one for each of text and non-text content that the
 * profile magnifies, each at the amount in force.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, magnification}
 */
function magnificationFields(settings: Magnification, { messages, language }: FieldContext): Field[] {
  const format = percent(language);
  const field = (part: "allContent" | "text" | "nonText", label: string, zoom: Zoom | undefined): Field => {
    const amount = zoom?.zoomAmount !== undefined && zoom.zoomAmount > 0 ? zoom.zoomAmount : DEFAULT_ZOOM;
    return numberField(`zoom-${part}`, label, ZOOM_AMOUNTS, amount, format, (zoomAmount) => ({
      ...settings,
      [part]: { ...zoom, zoomAmount },
    }));
  };
  if (settings.text === undefined && settings.nonText === undefined) {
    return [field("allContent", messages.settingZoom, settings.allContent)];
  }
  return [
    ...(settings.text === undefined ? [] : [field("text", messages.settingZoomText, settings.text)]),
    ...(settings.nonText === undefined ? [] : [field("nonText", messages.settingZoomNonText, settings.nonText)]),
  ];
}

/** The message that names each term of `link-indication`. */
const LINK_INDICATIONS: readonly (readonly [LinkIndication, keyof Messages])[] = [
  ["speak-link", "linkIndicationSpeakLink"],
  ["different-voice", "linkIndicationDifferentVoice"],
  ["sound-effect", "linkIndicationSoundEffect"],
  ["none", "linkIndicationNone"],
];

/** The message that names each term of `typing-echo`. */
const TYPING_ECHOES: readonly (readonly [TypingEcho, keyof Messages])[] = [
  ["characters", "typingEchoCharacters"],
  ["words", "typingEchoWords"],
  ["characters-and-words", "typingEchoCharactersAndWords"],
  ["none", "typingEchoNone"],
];

/**
 * The lists of the preferences of reading aloud, which the voice of the player follows: the rate, the pitch, the volume, how
 * a link is read and what typing echoes. A screen reader has preferences of its own, so they show for `computer-read-aloud`
 * only.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, spoken}
 */
function spokenFields(settings: Spoken, context: FieldContext): Field[] {
  if (settings.readingType !== "computer-read-aloud") return [];
  const { messages, language } = context;
  const share = percent(language);
  return [
    numberField(
      "speech-rate",
      messages.settingSpeechRate,
      SPEECH_RATES,
      settings.speechRate,
      new Intl.NumberFormat(language).format,
      (speechRate) => ({ ...settings, speechRate }),
    ),
    numberField("pitch", messages.settingPitch, PITCHES, settings.pitch, share, (pitch) => ({ ...settings, pitch })),
    numberField("volume", messages.settingVolume, VOLUMES, settings.volume, share, (volume) => ({
      ...settings,
      volume,
    })),
    termField(
      "link-indication",
      messages.settingLinkIndication,
      context,
      LINK_INDICATIONS,
      settings.linkIndication,
      (linkIndication) => ({ ...settings, linkIndication }),
    ),
    termField("typing-echo", messages.settingTypingEcho, context, TYPING_ECHOES, settings.typingEcho, (typingEcho) => ({
      ...settings,
      typingEcho,
    })),
  ];
}

/** Returns the settings of a support that the profile gave none, as an empty element of the profile reads. */
function emptySettings(name: SupportName): SupportSetting | undefined {
  switch (name) {
    case "magnification":
    case "text-appearance":
      return { name, replaceAccessModes: [] };
    case "spoken":
      return { name, replaceAccessModes: [], restrictionTypes: [] };
    default:
      return undefined;
  }
}

/** Returns the lists of a support that is on: those of the settings that the candidate may change and the player follows. */
function fieldsOf(support: SupportView, context: FieldContext): Field[] {
  const settings = support.settings ?? emptySettings(support.name);
  switch (settings?.name) {
    case "text-appearance":
      return textAppearanceFields(settings, context);
    case "magnification":
      return magnificationFields(settings, context);
    case "spoken":
      return spokenFields(settings, context);
    default:
      return [];
  }
}

/** The list of one setting in the panel. */
interface Control {
  /** The item of the panel that holds the list. */
  readonly item: HTMLLIElement;
  /** Shows the value in force, which goes into the list when the list lacks it. */
  show(field: Field): void;
}

function createControl(first: Field, onSettings: (settings: SupportSetting) => void): Control {
  let field = first;
  const options = first.choices.map(([value, text]) => html("option", { value }, text));
  const select = html("select", { class: "ak-support-select" }, ...options);
  select.addEventListener("change", () => {
    const settings = field.choose(select.value);
    if (settings !== undefined) onSettings(settings);
  });
  return {
    item: html("li", {}, html("label", { class: "ak-support-field" }, first.label, select)),
    show(next) {
      field = next;
      const { value } = next;
      if (value !== undefined && ![...select.options].some((option) => option.value === value)) {
        select.append(html("option", { value }, next.text(value)));
      }
      // A value that no option has selects none, so the list shows that the settings leave the value to the player.
      select.value = value ?? "";
    },
  };
}

/** The lists of the settings of the supports that are on, which the panel shows. */
export interface SettingsControls {
  /**
   * Returns the items of the lists of the supports that are on, in the order of the supports, each showing the value in
   * force; a list that a support no longer has is taken out of the panel.
   *
   * @param supports - The supports of the view.
   * @returns The items, which the panel places.
   */
  update(supports: readonly SupportView[]): HTMLLIElement[];
}

/**
 * Creates the lists of the settings that the candidate may change during the session: the color theme of the text appearance,
 * the amount of magnification and the preferences of reading aloud.
 *
 * @remarks
 * Each list is a `select` with a label, so that the keyboard, the pointer and a screen reader operate it as they operate any
 * list of the page. A choice is reported whole, as the runtime's `support-settings` action takes it; the list then shows what
 * the next view says, not the request.
 *
 * @param context - The text and the language of the interface.
 * @param onSettings - Called with the settings that the candidate chose.
 * @returns The lists.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/conf/ | QTI 3.0 Conformance and Certification, A-30a, A-30b, A-40d and A-40e}
 */
export function createSettingsControls(
  context: FieldContext,
  onSettings: (settings: SupportSetting) => void,
): SettingsControls {
  const controls = new Map<string, Control>();
  return {
    update(supports) {
      const items: HTMLLIElement[] = [];
      const shown = new Set<string>();
      for (const support of supports) {
        if (!support.active) continue;
        for (const field of fieldsOf(support, context)) {
          const key = `${support.name} ${field.key}`;
          const control = controls.get(key) ?? createControl(field, onSettings);
          controls.set(key, control);
          control.show(field);
          shown.add(key);
          items.push(control.item);
        }
      }
      for (const [key, control] of controls) {
        if (shown.has(key)) continue;
        control.item.remove();
        controls.delete(key);
      }
      return items;
    },
  };
}
