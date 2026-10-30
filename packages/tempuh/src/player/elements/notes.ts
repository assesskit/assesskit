import { html, uniqueId } from "../dom.js";

/**
 * What an interaction says besides its task: the limits it asks for, the hints for a response that breaks a rule, and the
 * announcements of what the candidate just did. The hints and the announcements are `role="status"` regions that are
 * never focused, so that a screen reader says them without moving the candidate (WCAG 4.1.3).
 */
export class Notes {
  /** The element for the interaction: `div.tempuh-notes`, or a `span` of the same class inside a line of text. */
  readonly element: HTMLElement;
  readonly #instruction: HTMLElement;
  readonly #hint: HTMLElement;
  readonly #announcement: HTMLElement;

  /**
   * @param inline - Whether the notes stand inside a line of text, as those of a text entry do. Default: `false`.
   */
  constructor(inline = false) {
    const tag = inline ? "span" : "div";
    this.#instruction = html(tag, { class: "tempuh-instruction", id: uniqueId("tempuh-instruction") });
    this.#hint = html(tag, { class: "tempuh-hint", id: uniqueId("tempuh-hint"), role: "status" });
    this.#announcement = html(tag, { class: "qti-visually-hidden", role: "status" });
    this.element = html(tag, { class: "tempuh-notes" }, this.#instruction, this.#hint, this.#announcement);
  }

  /** Sets the limits that the candidate is told; the empty text takes them away. */
  setInstruction(text: string): void {
    this.#instruction.textContent = text;
  }

  /** Sets the hints for a response that breaks rules, one for each rule; none takes them away. */
  setHints(texts: readonly string[]): void {
    const text = texts.join(" ");
    // The region says what changes, so the same text is not set again.
    if (this.#hint.textContent !== text) this.#hint.textContent = text;
  }

  /** Says something to the candidate who cannot see the change, such as where a choice was put. */
  announce(text: string): void {
    this.#announcement.textContent = text;
  }

  /** Returns the `id`s that a control is described by: the limits and, while there are any, the hints. */
  describedBy(): string {
    return [this.#instruction, this.#hint]
      .filter((part) => part.textContent !== "")
      .map((part) => part.id)
      .join(" ");
  }
}
