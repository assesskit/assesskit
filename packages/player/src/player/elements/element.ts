import type { Interaction } from "@assesskit/runtime/asi";
import { checkBoolean, describe, isRecord } from "@assesskit/runtime/checks";
import { AssesskitError, DataError } from "@assesskit/runtime/errors";
import { type InteractionDescriptor, type InteractionKind, validateResponse } from "@assesskit/runtime/interactions";
import { matchValues, normalizeValue, type Value } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import { checkMessages } from "../../messages/internal.js";
import type { BodyRenderer } from "../content/index.js";
import { type CustomMessages, instructionText, violationText } from "./hints.js";
import type { Notes } from "./notes.js";

/** The name of the event that an interaction element dispatches when the candidate changes a response. */
export const RESPONSE_EVENT = "ak-response";

/** What a {@link ResponseEvent} says: the response variable that changed and its new value, `null` for NULL. */
export interface ResponseDetail {
  /** The response variable: that of the interaction, or its `string-identifier` for the text as typed. */
  readonly responseIdentifier: string;
  /** The value the candidate gave. */
  readonly value: Value | null;
}

/**
 * The event that an interaction element dispatches, and that bubbles to the content root, when a response changes.
 *
 * @remarks
 * Its `detail` is a {@link ResponseDetail}.
 */
type ResponseEvent = CustomEvent<ResponseDetail>;

declare global {
  interface HTMLElementEventMap {
    [RESPONSE_EVENT]: ResponseEvent;
  }
  interface ShadowRootEventMap {
    [RESPONSE_EVENT]: ResponseEvent;
  }
}

/** Returns whether two plain values hold the same data: objects by their properties, arrays by their items. */
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => sameData(item, b[i]));
  if (!(isRecord(a) && isRecord(b))) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameData(a[key], b[key]))
  );
}

/**
 * Returns whether two responses are the same value, as `qti-match` reads them; NULL is the same as NULL.
 *
 * @param a - The first response.
 * @param b - The second response.
 * @returns `true` when they match.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, match}
 */
export const sameValue = (a: Value | null, b: Value | null): boolean =>
  a === null || b === null ? a === b : matchValues(a, b);

/**
 * The class that the elements extend. A server that renders a page imports the player where there is no `HTMLElement`, so
 * there the class is an empty one, which lets the module load; `defineElements` and the mounts need a browser.
 */
const ElementBase: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

/**
 * The element of an interaction: what the player gives the content root for `qti-…-interaction`.
 *
 * @remarks
 * The host sets four properties on it and listens for one event.
 *
 * | Property     | Meaning                                                                                                      |
 * | ------------ | ------------------------------------------------------------------------------------------------------------ |
 * | `descriptor` | The `InteractionDescriptor` of the runtime. Until it is set the element shows the content and no controls.   |
 * | `value`      | The response, `null` for NULL. The element shows it and keeps what the candidate gives in place of it.       |
 * | `disabled`   | Whether the candidate cannot respond, as in review. It is `false` at first.                                  |
 * | `messages`   | The text of the interface; the renderer sets it.                                                             |
 *
 * The element dispatches {@link ResponseEvent}s when the candidate changes the response. It decides nothing of QTI: the
 * runtime's `validateResponse` says whether the response is valid, and the element says what is wrong in words. Setting a
 * property to what it holds does nothing, so that a host that sets every property on each view leaves the candidate's
 * focus and caret where they are.
 *
 * @see {@link https://www.w3.org/TR/WCAG22/#error-identification | WCAG 2.2, error identification}
 */
export abstract class InteractionElement extends ElementBase {
  /** The kind of interaction the element is for, such as `choice-interaction`. */
  abstract readonly kind: InteractionKind;
  #descriptor: InteractionDescriptor | undefined;
  #value: Value | null = null;
  #disabled = false;
  #messages: Messages | undefined;
  /** Where the limits, the hints and the announcements go; the element sets it when it builds its content. */
  protected notes: Notes | undefined;
  /** The item's own texts for the rules a response breaks. */
  protected custom: CustomMessages = {};

  /** The response variable the interaction binds. */
  get responseIdentifier(): string {
    return this.getAttribute("response-identifier") ?? "";
  }

  /** The descriptor of the interaction, or `undefined` until the host sets it. */
  get descriptor(): InteractionDescriptor | undefined {
    return this.#descriptor;
  }

  /**
   * Sets the descriptor of the interaction, which builds the controls.
   *
   * @param descriptor - The descriptor of the runtime for this kind of interaction and this response variable.
   * @throws `DataError` when the value is not a descriptor of this kind of interaction and this response variable.
   */
  set descriptor(descriptor: InteractionDescriptor) {
    // validateResponse checks the whole descriptor, as the element reads it.
    validateResponse(descriptor, null);
    if (descriptor.kind !== this.kind || descriptor.responseIdentifier !== this.responseIdentifier) {
      throw new DataError(
        `The descriptor must be that of the ${this.kind} for ${describe(this.responseIdentifier)}, found ${describe(descriptor.kind)} for ${describe(descriptor.responseIdentifier)}.`,
      );
    }
    if (this.#descriptor !== undefined && sameData(this.#descriptor, descriptor)) return;
    this.#descriptor = descriptor;
    this.#update(true);
  }

  /** The response that the element shows: the host's, or the candidate's since. */
  get value(): Value | null {
    return this.#value;
  }

  /**
   * Sets the response that the element shows.
   *
   * @param value - The response, or `null` for NULL.
   * @throws `DataError` when the value is neither NULL nor a value of the runtime.
   */
  set value(value: Value | null) {
    const next = value === null ? null : normalizeValue(value);
    if (sameValue(this.#value, next)) return;
    this.#value = next;
    this.#update(false);
  }

  /** Whether the candidate cannot respond. */
  get disabled(): boolean {
    return this.#disabled;
  }

  /**
   * Sets whether the candidate cannot respond.
   *
   * @param disabled - `true` where the candidate cannot respond.
   * @throws `DataError` when the value is not a boolean.
   */
  set disabled(disabled: boolean) {
    checkBoolean(disabled, "The property disabled");
    if (this.#disabled === disabled) return;
    this.#disabled = disabled;
    this.#update(false);
  }

  /** The text of the interface, or `undefined` before the renderer sets it. */
  get messages(): Messages | undefined {
    return this.#messages;
  }

  /**
   * Sets the text of the interface and builds the controls again.
   *
   * @param messages - The messages.
   * @throws `DataError` when the value is not the messages of the interface.
   */
  set messages(messages: Messages) {
    checkMessages(messages);
    this.#messages = messages;
    this.#update(true);
  }

  /**
   * Builds, or builds again, the controls: the descriptor or the messages are new.
   *
   * @remarks
   * The content that the node gave stays.
   *
   * @param descriptor - The descriptor.
   * @param messages - The messages.
   */
  protected abstract configure(descriptor: InteractionDescriptor, messages: Messages): void;

  /**
   * Shows the response and whether the candidate can respond.
   *
   * @param descriptor - The descriptor.
   * @param messages - The messages.
   */
  protected abstract sync(descriptor: InteractionDescriptor, messages: Messages): void;

  /**
   * Resolves when the response is final, which is at once unless the element has work that its response waits for, such
   * as a drawing that is being stored.
   *
   * @remarks
   * The host waits for it before it submits.
   *
   * @returns A promise that resolves when the response is final.
   */
  settled(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Returns the elements that say they are invalid and are described by the limits and the hints.
   *
   * @remarks
   * The element itself is the default.
   *
   * @returns The elements.
   */
  protected controls(): readonly Element[] {
    return [this];
  }

  /**
   * Returns hints of the element's own, besides those of the runtime's rules.
   *
   * @remarks
   * None is the default.
   *
   * @param _messages - The messages.
   * @returns The hints.
   */
  protected extraHints(_messages: Messages): readonly string[] {
    return [];
  }

  /**
   * Gives a response: the element keeps it as its value and tells the host with a {@link ResponseEvent}.
   *
   * @param value - The response.
   * @param responseIdentifier - The variable that changed; that of the interaction without it.
   */
  protected respond(value: Value | null, responseIdentifier = this.responseIdentifier): void {
    if (responseIdentifier === this.responseIdentifier) {
      this.#value = value;
      this.#update(false);
    }
    const detail: ResponseDetail = { responseIdentifier, value };
    this.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail, bubbles: true }));
  }

  /** Shows the element again, for a change of the element's own that the four properties do not carry. */
  protected refresh(): void {
    this.#update(false);
  }

  #update(reconfigure: boolean): void {
    const descriptor = this.#descriptor;
    const messages = this.#messages;
    if (descriptor === undefined || messages === undefined) return;
    if (reconfigure) this.configure(descriptor, messages);
    this.sync(descriptor, messages);
    this.#report(descriptor, messages);
  }

  /**
   * Tells the candidate what to change: a response that is not valid gets its hints, tied to the controls.
   *
   * @see {@link https://www.w3.org/TR/WCAG22/#error-identification | WCAG 2.2, error identification}
   */
  #report(descriptor: InteractionDescriptor, messages: Messages): void {
    const notes = this.notes;
    if (notes === undefined) return;
    const check = validateResponse(descriptor, this.#value);
    const reasons = check.status === "attempted" ? check.reasons : [];
    const texts = new Set([
      ...reasons.map((reason) => violationText(reason, descriptor, messages, this.custom)),
      ...this.extraHints(messages),
    ]);
    notes.setInstruction(instructionText(descriptor, messages));
    notes.setHints([...texts]);
    const describedBy = notes.describedBy();
    for (const control of this.controls()) {
      if (texts.size > 0) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
      if (describedBy === "") control.removeAttribute("aria-describedby");
      else control.setAttribute("aria-describedby", describedBy);
    }
  }
}

/**
 * Creates the element of an interaction with the attributes the player keeps, its response variable and the messages.
 *
 * @remarks
 * The renderer of a kind fills it with the content of its node.
 *
 * @param type - The class of the element.
 * @param name - The name that the class is defined under.
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns The element.
 * @throws `AssesskitError` when `name` is not defined as the element class, which `defineElements` does.
 */
export function createInteraction<TElement extends InteractionElement>(
  type: new () => TElement,
  name: string,
  node: Interaction,
  renderer: BodyRenderer,
  messages: Messages,
): TElement {
  const element = renderer.element(name, node, []);
  if (!(element instanceof type)) {
    throw new AssesskitError(`The element ${name} is not the interaction element: call defineElements first.`);
  }
  element.setAttribute("response-identifier", node.responseIdentifier);
  element.messages = messages;
  return element;
}
