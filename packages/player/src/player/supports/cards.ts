import type { SupportView } from "@assesskit/runtime/delivery";
import type { SupportName } from "@assesskit/runtime/pnp";
import type { Messages } from "../../messages/index.js";
import { html, replaceAll, uniqueId } from "../internal.js";
import { followPlayback, recordingOf } from "../media/index.js";
import { supportLabel } from "./names.js";
import { attachPopup } from "./popup.js";

/**
 * How a card shows: on request, in place of the content, or beside it.
 *
 * @remarks
 * The best practices guide leaves it to the player.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, catalogs and cards}
 */
export type CardKind = "popup" | "replace" | "alongside";

/**
 * The supports with cards, and how each shows.
 *
 * @remarks
 * A `qti-card` names one of 15 supports or an extension. The glossary, the translation of keywords and the guidance and
 * directions explain, so they wait for the candidate in a popup. High contrast and the simplified graphics and language
 * take the place of the content. Sign language, audio description, transcript, long description, braille and tactile
 * come beside the content. The `spoken` card is for the voice of a host, not for the screen.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, card}
 */
const CARD_KINDS: ReadonlyMap<SupportName, CardKind> = new Map<SupportName, CardKind>([
  ["glossary-on-screen", "popup"],
  ["keyword-translation", "popup"],
  ["linguistic-guidance", "popup"],
  ["additional-directions", "popup"],
  ["keyboard-directions", "popup"],
  ["high-contrast", "replace"],
  ["simplified-graphics", "replace"],
  ["simplified-language-portions", "replace"],
  ["sign-language", "alongside"],
  ["audio-description", "alongside"],
  ["transcript", "alongside"],
  ["long-description", "alongside"],
  ["braille", "alongside"],
  ["tactile", "alongside"],
]);

/**
 * A custom support has the cards of its catalogs shown on request, since the player knows nothing else of it.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, custom supports}
 */
const CUSTOM_KIND: CardKind = "popup";

/** The order in which the kinds apply to one element, so that what replaces the content does so before anything is added to it. */
export const CARD_KIND_ORDER: readonly CardKind[] = ["replace", "alongside", "popup"];

/**
 * Returns how the cards of a support show.
 *
 * @param name - The name of the support.
 * @returns The kind, or `undefined` for a support that has no cards.
 */
export function cardKindOf(name: SupportName): CardKind | undefined {
  return CARD_KINDS.get(name) ?? (name.startsWith("ext:") ? CUSTOM_KIND : undefined);
}

/** The elements that show a picture or play media, which a card replaces by hiding them and standing after them. */
const MEDIA: ReadonlySet<string> = new Set([
  "img",
  "picture",
  "video",
  "audio",
  "object",
  "iframe",
  "canvas",
  "svg",
  "math",
]);

/**
 * The elements that cannot hold content of their own, or whose content is not drawn (the fallback of media), so that
 * the card goes after them and not inside.
 */
const PLACED_AFTER: ReadonlySet<string> = new Set([...MEDIA, "input", "select", "textarea", "br", "hr"]);

/** The elements that hold a control, whose content a card must not replace. */
const CONTROLS = "input, select, textarea, button";

/** What a card needs to be shown. */
export interface CardContext {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The element that asked for the card with `data-catalog-idref`. */
  readonly element: Element;
  /** The support that was turned on. */
  readonly support: SupportView;
  /** The card, rendered. */
  readonly content: DocumentFragment;
  /** Returns the box that clips the content, which a popup stays inside. */
  readonly boundary: () => DOMRect;
}

/** Puts a node beside an element: inside, at the end, or after it when it cannot hold content. */
function addTo(element: Element, node: Node): void {
  if (PLACED_AFTER.has(element.localName)) element.after(node);
  else element.append(node);
}

/**
 * Hides an HTML content of a card from sight and leaves it to assistive technology.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/vocab/ | QTI 3 Standardized Shared Vocabulary, visually hidden}
 */
function hideVisually(content: DocumentFragment): void {
  for (const child of content.querySelectorAll("qti-html-content")) child.classList.add("qti-visually-hidden");
}

/** Returns whether the html content of the card is for assistive technology only. */
function isHidden(support: SupportView): boolean {
  const settings = support.settings;
  // The description is for a screen reader unless the profile says otherwise (PNP XSD `hide-visually` default).
  if (support.name === "long-description")
    return settings?.name !== "long-description" || settings.hideVisually !== false;
  // Braille text reaches a refreshable display through the screen reader, which reads it from the page.
  if (support.name === "braille") return settings?.name !== "braille" || settings.deliveryMode !== "embossed";
  return false;
}

/** The supports whose media is the recording of the element in another form, so that it plays only with that recording. */
const FOLLOWS_RECORDING: ReadonlySet<SupportName> = new Set(["sign-language", "audio-description"]);

/**
 * Makes the media of a card follow the recording of its element, when it is the same recording in another form (sign
 * language, audio description) and the element has one.
 *
 * @remarks
 * The sign language video of a listening task then plays, pauses and stops with the recording, so that `max-plays` and
 * the pauses of the item hold for it too.
 */
function followRecording(support: SupportView, element: Element, card: Element): () => void {
  const recording = FOLLOWS_RECORDING.has(support.name) ? recordingOf(element, card) : undefined;
  if (recording === undefined) return () => undefined;
  const releases = [...card.querySelectorAll<HTMLMediaElement>("audio, video")].map((media) =>
    followPlayback(recording, media),
  );
  return () => {
    for (const release of releases) release();
  };
}

/** Shows a card beside the content, in a group named after the support. Returns the function that takes it away. */
function showAlongside({ messages, element, support, content }: CardContext): () => void {
  if (isHidden(support)) hideVisually(content);
  const card = html("div", {
    class: "ak-card",
    role: "group",
    "aria-label": supportLabel(support.name, messages) ?? support.name,
    "data-ak-card": support.name,
  });
  card.append(content);
  addTo(element, card);
  const release = followRecording(support, element, card);
  return () => {
    release();
    card.remove();
  };
}

/**
 * Shows a card in place of the content.
 *
 * @remarks
 * A picture or media is hidden and the card stands after it; the face of a choice, else the element, gets the card for
 * its content. A control cannot give its place to a card, so its card comes beside it. Returns the function that
 * restores the content.
 */
function showInstead(context: CardContext): () => void {
  const { element, content } = context;
  if (MEDIA.has(element.localName)) {
    const shown = !element.hasAttribute("hidden");
    element.setAttribute("hidden", "");
    const remove = showAlongside(context);
    return () => {
      remove();
      if (shown) element.removeAttribute("hidden");
    };
  }
  const face = element.querySelector(".ak-face");
  const target = face ?? element;
  if (PLACED_AFTER.has(element.localName) || (face === null && target.querySelector(CONTROLS) !== null)) {
    return showAlongside(context);
  }
  const saved = [...target.childNodes];
  target.replaceChildren(content);
  return () => replaceAll(target, saved);
}

/** Shows a button that opens the card in a popup, which meets WCAG 1.4.13. Returns the function that takes it away. */
function showPopup({ messages, element, support, content, boundary }: CardContext): () => void {
  const name = supportLabel(support.name, messages) ?? support.name;
  const id = uniqueId("ak-card");
  const trigger = html(
    "button",
    {
      type: "button",
      class: "ak-card-trigger",
      "aria-expanded": "false",
      "aria-controls": id,
    },
    name,
  );
  // The name starts with the visible text, so that it contains the label of the button (WCAG 2.5.3).
  const close = html(
    "button",
    { type: "button", class: "ak-card-close", "aria-label": `${messages.toolClose} ${name}` },
    messages.toolClose,
  );
  const popup = html(
    "span",
    { class: "ak-popup", id, role: "group", "aria-label": name, hidden: "" },
    close,
    html("span", { class: "ak-popup-body" }, content),
  );
  const anchor = html("span", { class: "ak-card-anchor" }, trigger, popup);
  addTo(element, anchor);
  const detach = attachPopup({ anchor, trigger, popup, close, boundary });
  return () => {
    detach();
    anchor.remove();
  };
}

const SHOW: Readonly<Record<CardKind, (context: CardContext) => () => void>> = {
  popup: showPopup,
  replace: showInstead,
  alongside: showAlongside,
};

/**
 * Shows the card of a support on an element, the way the support asks for.
 *
 * @param kind - How the card shows.
 * @param context - What the card needs.
 * @returns A function that takes the card away and gives the element back as it was.
 */
export function showCard(kind: CardKind, context: CardContext): () => void {
  return SHOW[kind](context);
}
