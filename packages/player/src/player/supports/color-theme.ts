import type { ColorTheme } from "@assesskit/runtime/pnp";
import type { Messages } from "../../messages/index.js";
import { html } from "../internal.js";

/** The message that names each term of `color-theme`, in the order of the list: the themes of the interface, then the pairs of colors. */
const THEME_MESSAGES: ReadonlyMap<ColorTheme, keyof Messages> = new Map<ColorTheme, keyof Messages>([
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
]);

/** The prefix of a color theme of a program, which the list names by what follows it. */
const EXTENSION_PREFIX = "ext:";

/** The control of the color theme: a labeled list, whose text is that of the interface. */
export interface ColorThemeControl {
  /** The item of the panel that holds the list. */
  readonly item: HTMLLIElement;
  /**
   * Shows the theme in force, which goes into the list when it is a theme of a program.
   *
   * @param theme - The theme; `undefined` selects nothing, because the look then comes from the other supports.
   */
  update(theme: ColorTheme | undefined): void;
}

/**
 * Creates the control of the color theme.
 *
 * @remarks
 * The list holds every term of `color-theme`, so that the candidate can change the theme at any time and go back to the default
 * colors, as the best practices guide asks.
 *
 * @param messages - The text of the interface.
 * @param onColorTheme - Called with the theme that the candidate chooses.
 * @returns The control.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, color-theme}
 */
export function createColorThemeControl(
  messages: Messages,
  onColorTheme: (theme: ColorTheme) => void,
): ColorThemeControl {
  const terms = new Map<string, ColorTheme>(Array.from(THEME_MESSAGES.keys(), (term) => [term, term]));
  const options = Array.from(THEME_MESSAGES, ([term, key]) => html("option", { value: term }, messages[key]));
  const select = html("select", { class: "ak-support-select" }, ...options);
  select.addEventListener("change", () => {
    const theme = terms.get(select.value);
    if (theme !== undefined) onColorTheme(theme);
  });
  return {
    item: html("li", {}, html("label", { class: "ak-support-field" }, messages.colorTheme, select)),
    update(theme) {
      if (theme !== undefined && !terms.has(theme)) {
        terms.set(theme, theme);
        select.append(html("option", { value: theme }, theme.slice(EXTENSION_PREFIX.length)));
      }
      select.value = theme ?? "";
    },
  };
}
