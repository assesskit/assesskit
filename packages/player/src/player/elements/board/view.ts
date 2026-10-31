import type { Messages } from "../../../messages/index.js";
import { html } from "../../dom.js";
import type { Notes } from "../notes.js";
import type { Board } from "./model.js";

/** The distance in pixels that a pointer moves before a press becomes a drag. */
export const DRAG_THRESHOLD = 4;

/** A choice of the pool: the element that stands in the pool, what it shows, and its name for a person who cannot see it. */
export interface BoardToken {
  /** The identifier of the choice. */
  readonly id: string;
  /** The element of the choice in the pool; the view puts the button of the choice in it. */
  readonly element: Element;
  /** What the choice shows. */
  readonly content: readonly Node[];
  /** The name of the choice in announcements and in the names of buttons. */
  readonly name: string;
  /** Whether the content gives the name. Without it, the buttons of the choice are named by `name` (WCAG 4.1.2). */
  readonly named: boolean;
}

/** A place on the board: the element that holds the choices put in it, and its name. */
export interface BoardSlot {
  /** The identifier of the place. */
  readonly id: string;
  /** The element of the place; the view appends the chips and the button that puts a choice in the place to what it holds. */
  readonly element: Element;
  /** The name of the place in announcements and in the names of buttons. */
  readonly name: string;
}

/** What a {@link BoardView} needs. */
export interface BoardViewOptions {
  /** The state that the view shows and changes. */
  readonly board: Board;
  /** The text of the interface. */
  readonly messages: Messages;
  /** Where announcements go. */
  readonly notes: Notes;
  /** The interaction element, which Escape is heard in. */
  readonly root: HTMLElement;
  /** The area of the tokens; dropping a chip on it puts the choice back. */
  readonly pool: Element;
  /** The choices. */
  readonly tokens: readonly BoardToken[];
  /** The places. */
  readonly slots: readonly BoardSlot[];
  /** Called after the candidate changed the board. */
  readonly changed: () => void;
}

/** A choice that the candidate picked up, and the place it came from when it was in one. */
interface Held {
  readonly source: string;
  readonly from?: string;
}

/** A press of a mouse or a pen that may become a drag. */
interface Press {
  readonly held: Held;
  readonly button: HTMLElement;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  dragging: boolean;
}

/**
 * The controls of a board: a token in the pool for each choice, a chip for each choice in a place, and a button in each
 * place that has room. The candidate picks a choice up and chooses where to put it, with a click, a tap or the keyboard;
 * a mouse or a pen can also drag it, so that no one has to drag (WCAG 2.1.1, 2.5.7). Escape lets go of a choice, and the
 * button of a chip takes it out of its place. The view draws what the board holds and says what happened in the notes.
 */
export class BoardView {
  readonly #options: BoardViewOptions;
  /** The buttons of the choices, by the choice and the place it is in (empty for the pool): `A|` or `A|gap1`. */
  readonly #buttons = new Map<string, HTMLElement>();
  readonly #drops = new Map<string, HTMLElement>();
  #held: Held | undefined;
  #press: Press | undefined;
  #suppressClick = false;
  #disabled = false;

  /** @param options - See {@link BoardViewOptions}. */
  constructor(options: BoardViewOptions) {
    this.#options = options;
    for (const token of options.tokens) token.element.replaceChildren(this.#button(token, undefined, token.content));
    options.root.addEventListener("keydown", this.#onKeydown);
  }

  /** Stops listening to the element, for a view that a new one replaces. */
  dispose(): void {
    this.#options.root.removeEventListener("keydown", this.#onKeydown);
  }

  readonly #onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.#held === undefined) return;
    this.#held = undefined;
    this.render();
  };

  /** Locks the controls for a candidate who cannot respond, or unlocks them. */
  lock(disabled: boolean): void {
    if (this.#disabled === disabled) return;
    this.#disabled = disabled;
    this.#held = undefined;
    this.render();
  }

  /** Draws the board as the state holds it. */
  render(): void {
    const { board, tokens, slots, messages, root } = this.#options;
    // The stylesheet shows the gaps of an image while the candidate has a choice in hand (VOCAB §1.2.10.3).
    root.toggleAttribute("data-ak-placing", this.#held !== undefined);
    this.#buttons.clear();
    this.#drops.clear();
    for (const token of tokens) {
      token.element.toggleAttribute("hidden", board.remaining(token.id) < 1);
      const button = token.element.querySelector("button");
      if (button) this.#register(button, token.id, undefined);
    }
    for (const slot of slots) {
      for (const old of slot.element.querySelectorAll(".ak-chip, .ak-drop")) old.remove();
      const chips = board.occupants(slot.id).map((source) => this.#chip(source, slot));
      const drop = board.isFull(slot.id) ? [] : [this.#drop(slot, messages)];
      slot.element.append(...chips, ...drop);
    }
  }

  /** Lists a button of a choice, and shows whether the candidate picked it up and whether it can be pressed. */
  #register(button: HTMLElement, source: string, place: string | undefined): void {
    const held = this.#held;
    button.setAttribute("aria-pressed", String(held?.source === source && held.from === place));
    button.toggleAttribute("disabled", this.#disabled);
    this.#buttons.set(`${source}|${place ?? ""}`, button);
  }

  #token(source: string): BoardToken | undefined {
    return this.#options.tokens.find((token) => token.id === source);
  }

  #slot(place: string): BoardSlot | undefined {
    return this.#options.slots.find((slot) => slot.id === place);
  }

  /** Builds the button of a choice: its token when it is in the pool, the face of its chip when it is in a place. */
  #button(token: BoardToken, place: string | undefined, content: readonly Node[]): HTMLElement {
    const button = html("button", { type: "button", class: "ak-token", "aria-pressed": "false" }, ...content);
    if (!token.named) button.setAttribute("aria-label", token.name);
    const source = token.id;
    button.addEventListener("click", () => this.#click(source, place));
    button.addEventListener("pointerdown", (event) =>
      this.#down(event, { source, ...(place === undefined ? {} : { from: place }) }, button),
    );
    button.addEventListener("pointermove", (event) => this.#move(event));
    button.addEventListener("pointerup", (event) => this.#up(event));
    button.addEventListener("pointercancel", () => this.#endDrag());
    return button;
  }

  #chip(source: string, slot: BoardSlot): HTMLElement {
    const token = this.#token(source);
    if (token === undefined) return html("span");
    const content = [...(token.element.querySelector("button")?.childNodes ?? [])].map((node) => node.cloneNode(true));
    const face = this.#button(token, slot.id, content);
    face.classList.replace("ak-token", "ak-chip-button");
    this.#register(face, source, slot.id);
    const remove = html("button", {
      type: "button",
      class: "ak-remove",
      "aria-label": `${this.#options.messages.boardRemove} ${token.name}`,
    });
    remove.toggleAttribute("disabled", this.#disabled);
    remove.addEventListener("click", () => this.#takeOut(source, slot));
    return html("span", { class: "ak-chip" }, face, remove);
  }

  #drop(slot: BoardSlot, messages: Messages): HTMLElement {
    const label = messages.boardPlaceHere;
    const button = html("button", { type: "button", class: "ak-drop", "aria-label": `${label}, ${slot.name}` }, label);
    button.toggleAttribute("disabled", this.#disabled);
    button.addEventListener("click", () => this.#putHeld(slot));
    this.#drops.set(slot.id, button);
    return button;
  }

  /** Handles a press on a choice: pick it up, let it go, or, with another in hand, put that one in the place of this chip. */
  #click(source: string, place: string | undefined): void {
    if (this.#suppressClick) return;
    const held = this.#held;
    const slot = place === undefined ? undefined : this.#slot(place);
    if (held !== undefined && slot !== undefined && !(held.source === source && held.from === place)) {
      this.#putHeld(slot);
      return;
    }
    this.#held =
      held?.source === source && held.from === place
        ? undefined
        : { source, ...(place === undefined ? {} : { from: place }) };
    this.render();
    this.#buttons.get(`${source}|${place ?? ""}`)?.focus();
    if (this.#held !== undefined)
      this.#options.notes.announce(`${this.#token(source)?.name ?? source} ${this.#options.messages.boardSelected}`);
  }

  /** Puts the choice in hand in a place. */
  #putHeld(slot: BoardSlot): void {
    const held = this.#held;
    if (held === undefined) this.#options.notes.announce(this.#options.messages.boardNothingSelected);
    else this.#place(held, slot);
  }

  #place(held: Held, slot: BoardSlot): void {
    const { board, notes, messages } = this.#options;
    this.#held = undefined;
    const placed = board.put(held.source, slot.id, held.from);
    this.render();
    if (!placed) return;
    this.#buttons.get(`${held.source}|${slot.id}`)?.focus();
    notes.announce(`${this.#token(held.source)?.name ?? held.source} ${messages.boardPlaced} ${slot.name}`);
    this.#options.changed();
  }

  /** Takes a choice out of its place, back to the pool. */
  #takeOut(source: string, slot: BoardSlot): void {
    const { board, notes, messages } = this.#options;
    if (!board.take(source, slot.id)) return;
    this.#held = undefined;
    this.render();
    (this.#buttons.get(`${source}|`) ?? this.#drops.get(slot.id))?.focus();
    notes.announce(`${this.#token(source)?.name ?? source} ${messages.boardRemoved}`);
    this.#options.changed();
  }

  #down(event: PointerEvent, held: Held, button: HTMLElement): void {
    this.#suppressClick = false;
    // A touch scrolls the page; it picks up and puts down with taps.
    if (event.button !== 0 || event.pointerType === "touch" || this.#disabled) return;
    this.#press = { held, button, pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    button.setPointerCapture(event.pointerId);
  }

  #move(event: PointerEvent): void {
    const press = this.#press;
    if (press === undefined || press.pointerId !== event.pointerId) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!press.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    press.dragging = true;
    press.button.classList.add("ak-dragging");
    press.button.style.transform = `translate(${dx}px, ${dy}px)`;
    const over = this.#under(event).slot;
    for (const slot of this.#options.slots) slot.element.toggleAttribute("data-ak-over", slot === over);
  }

  #up(event: PointerEvent): void {
    const press = this.#press;
    if (press === undefined || press.pointerId !== event.pointerId) return;
    const wasDragging = press.dragging;
    const { slot, pool } = this.#under(event);
    this.#endDrag();
    if (!wasDragging) return;
    // The click that follows a drag is not a press on a choice.
    this.#suppressClick = true;
    setTimeout(() => {
      this.#suppressClick = false;
    }, 0);
    if (slot !== undefined) this.#place(press.held, slot);
    else if (pool && press.held.from !== undefined) {
      const origin = this.#slot(press.held.from);
      if (origin !== undefined) this.#takeOut(press.held.source, origin);
    }
  }

  /** Ends a press: the choice goes back to where it stood on the screen. */
  #endDrag(): void {
    const press = this.#press;
    this.#press = undefined;
    if (press === undefined) return;
    press.button.classList.remove("ak-dragging");
    press.button.style.removeProperty("transform");
    for (const slot of this.#options.slots) slot.element.removeAttribute("data-ak-over");
  }

  /** Returns the place and whether the pool is under the pointer. */
  #under(event: PointerEvent): { readonly slot?: BoardSlot; readonly pool: boolean } {
    const root = this.#options.pool.getRootNode();
    if (!(root instanceof Document || root instanceof ShadowRoot)) return { pool: false };
    const stack = root.elementsFromPoint(event.clientX, event.clientY);
    const slot = this.#options.slots.find(({ element }) => stack.includes(element));
    return { ...(slot === undefined ? {} : { slot }), pool: stack.includes(this.#options.pool) };
  }
}
