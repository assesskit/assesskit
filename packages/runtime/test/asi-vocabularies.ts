/**
 * The vocabularies of the content that the unit and the schema tests check, with the terms that the Information Model gives each. The
 * element is where an item body puts an attribute of the vocabulary; the attribute is as written, and the property is the
 * name in the model.
 */
export interface Vocabulary {
  /** The inventory row, such as `W1`. */
  readonly row: string;
  /** The name of the vocabulary in the Information Model. */
  readonly name: string;
  /** The element that has the attribute. */
  readonly element: "div" | "td" | "audio" | "video" | "track" | "param";
  /** The attribute as written. */
  readonly attribute: string;
  /** The property of the model. */
  readonly property: string;
  /** The terms. */
  readonly terms: readonly string[];
}

/** The markup of an element of an item body that has the given attributes, and the keys that lead from the body to it. */
export const PLACES = {
  div: { markup: (attributes: string) => `<div${attributes}/>`, path: [] },
  td: {
    markup: (attributes: string) => `<table><tr><td${attributes}>x</td></tr></table>`,
    path: ["rows", 0, "cells", 0],
  },
  audio: { markup: (attributes: string) => `<audio${attributes}/>`, path: [] },
  video: { markup: (attributes: string) => `<video${attributes}/>`, path: [] },
  track: { markup: (attributes: string) => `<video><track src="a.vtt"${attributes}/></video>`, path: ["children", 0] },
  param: {
    markup: (attributes: string) =>
      `<p><object data="a" type="text/plain"><param name="n" value="v"${attributes}/></object></p>`,
    path: ["children", 0, "children", 0],
  },
} as const;

/** The 74 role values of the Information Model. */
const ARIA_ROLES = [
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "button",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "document",
  "emphasis",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "meter",
  "navigation",
  "note",
  "option",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
];

/** The vocabularies of the content, by row. */
export const VOCABULARIES: readonly Vocabulary[] = [
  {
    row: "W1",
    name: "ARIAAutoCompleteEnum",
    element: "div",
    attribute: "aria-autocomplete",
    property: "ariaAutocomplete",
    terms: ["both", "inline", "list", "none"],
  },
  {
    row: "W2",
    name: "ARIACheckedEnum",
    element: "div",
    attribute: "aria-checked",
    property: "ariaChecked",
    terms: ["false", "mixed", "true", "undefined"],
  },
  {
    row: "W3",
    name: "ARIACurrentEnum",
    element: "div",
    attribute: "aria-current",
    property: "ariaCurrent",
    terms: ["date", "false", "location", "page", "step", "time", "true", "undefined"],
  },
  {
    row: "W4",
    name: "ARIAExpandedEnum",
    element: "div",
    attribute: "aria-expanded",
    property: "ariaExpanded",
    terms: ["false", "true", "undefined"],
  },
  {
    row: "W5",
    name: "ARIAInvalidEnum",
    element: "div",
    attribute: "aria-invalid",
    property: "ariaInvalid",
    terms: ["false", "grammar", "spelling", "true"],
  },
  {
    row: "W6",
    name: "ARIALiveValueEnum",
    element: "div",
    attribute: "aria-live",
    property: "ariaLive",
    terms: ["assertive", "off", "polite"],
  },
  {
    row: "W7",
    name: "ARIAOrientationValueEnum",
    element: "div",
    attribute: "aria-orientation",
    property: "ariaOrientation",
    terms: ["horizontal", "vertical"],
  },
  {
    row: "W8",
    name: "ARIAPressedEnum",
    element: "div",
    attribute: "aria-pressed",
    property: "ariaPressed",
    terms: ["false", "mixed", "true", "undefined"],
  },
  { row: "W9", name: "ARIARoleValue", element: "div", attribute: "role", property: "role", terms: ARIA_ROLES },
  {
    row: "W10",
    name: "ARIASelectedEnum",
    element: "div",
    attribute: "aria-selected",
    property: "ariaSelected",
    terms: ["false", "true", "undefined"],
  },
  {
    row: "W11",
    name: "ARIASortEnum",
    element: "div",
    attribute: "aria-sort",
    property: "ariaSort",
    terms: ["ascending", "descending", "none", "other"],
  },
  {
    row: "W12",
    name: "AlignEnum",
    element: "td",
    attribute: "align",
    property: "align",
    terms: ["center", "char", "justify", "left", "right"],
  },
  {
    row: "W14",
    name: "CORSSettingsEnum",
    element: "audio",
    attribute: "crossorigin",
    property: "crossorigin",
    terms: ["anonymous", "use-credentials"],
  },
  { row: "W17", name: "DIR", element: "div", attribute: "dir", property: "dir", terms: ["auto", "ltr", "rtl"] },
  {
    row: "W19",
    name: "KindValueEnum",
    element: "track",
    attribute: "kind",
    property: "trackKind",
    terms: ["captions", "chapters", "descriptions", "metadata", "subtitles"],
  },
  {
    row: "W24",
    name: "ParamTypeEnum",
    element: "param",
    attribute: "valuetype",
    property: "valuetype",
    terms: ["DATA", "REF"],
  },
  {
    row: "W25",
    name: "PreLoadValueEnum",
    element: "video",
    attribute: "preload",
    property: "preload",
    terms: ["auto", "metadata", "none"],
  },
  {
    row: "W34",
    name: "SuppressTTSEnum",
    element: "div",
    attribute: "data-qti-suppress-tts",
    property: "dataQtiSuppressTts",
    terms: ["all", "computer-read-aloud", "screen-reader"],
  },
  {
    row: "W35",
    name: "TableCellScopeEnum",
    element: "td",
    attribute: "scope",
    property: "scope",
    terms: ["col", "colgroup", "row", "rowgroup"],
  },
  {
    row: "W42",
    name: "ValignEnum",
    element: "td",
    attribute: "valign",
    property: "valign",
    terms: ["baseline", "bottom", "middle", "top"],
  },
];

/** Returns the vocabulary of a row. */
export function vocabularyOf(row: string): Vocabulary {
  const vocabulary = VOCABULARIES.find((candidate) => candidate.row === row);
  if (vocabulary === undefined) throw new Error(`There is no vocabulary for the row ${row}.`);
  return vocabulary;
}
