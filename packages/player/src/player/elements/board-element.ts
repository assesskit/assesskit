import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Pair, Value } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import { html } from "../internal.js";
import { type Assignment, Board, type BoardPlace, type BoardSource } from "./board/model.js";
import { type BoardSlot, type BoardToken, BoardView } from "./board/view.js";
import { InteractionElement, sameValue } from "./element.js";
import { type BuiltChoice, choiceName, nameByPrompt, type RenderedPrompt } from "./parts.js";
import { pairsOf, responseOf } from "./values.js";

/** What an interaction on a board draws: the choices, the places, and where they stand. */
export interface BoardLayout {
  /** The choices and how often each can be put in a place. */
  readonly sources: readonly BoardSource[];
  /** The places and what each holds, in the order the response lists them. */
  readonly places: readonly BoardPlace[];
  /** The choices as they stand in the pool. */
  readonly tokens: readonly BoardToken[];
  /** The places as they stand on the screen. */
  readonly slots: readonly BoardSlot[];
  /** The area of the tokens. */
  readonly pool: Element;
}

/**
 * Returns the choices as tokens of the pool, each with a name that a person who cannot see it can read.
 *
 * @param choices - The built choices.
 * @param messages - The interface messages.
 * @returns The tokens.
 */
export function tokensOf(choices: readonly BuiltChoice[], messages: Messages): BoardToken[] {
  return choices.map((choice, index) => ({
    id: choice.id,
    element: choice.element,
    content: choice.content,
    name: choiceName(choice.name, index, messages),
    named: choice.name !== "",
  }));
}

/**
 * Returns how many times each choice can be put in a place: its `match-max`, or no limit when it has none.
 *
 * @param descriptor - The descriptor of the interaction.
 * @returns A function from the identifier of a choice to its limit.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, match max}
 */
export function limitsOf(descriptor: InteractionDescriptor): (identifier: string) => number {
  const limits = new Map(descriptor.choices.map(({ identifier, matchMax }) => [identifier, matchMax]));
  return (identifier) => limits.get(identifier) ?? Number.POSITIVE_INFINITY;
}

/**
 * Returns the area of the pool: the choices that are not placed, in a group that a screen reader names.
 *
 * @param choices - The built choices.
 * @param messages - The interface messages.
 * @returns The area.
 */
export function poolOf(choices: readonly BuiltChoice[], messages: Messages): HTMLElement {
  return html(
    "div",
    { class: "ak-choices", role: "group", "aria-label": messages.boardChoices },
    ...choices.map(({ element }) => element),
  );
}

/**
 * The element of an interaction in which the candidate puts choices in places: an order, an association, a match or a
 * gap match.
 *
 * @remarks
 * It keeps a {@link Board} and draws it with a {@link BoardView}; each kind says how the board is laid out and how it
 * maps to the response.
 */
export abstract class BoardElement extends InteractionElement {
  #board: Board | undefined;
  #view: BoardView | undefined;

  /** Lays the content out for the descriptor: the pool and the places are in the element when it returns. */
  protected abstract layout(descriptor: InteractionDescriptor, messages: Messages): BoardLayout;

  /** Returns the response for what the board holds. */
  protected abstract toValue(descriptor: InteractionDescriptor, board: Board): Value | null;

  /** Returns the choices in places that a response holds. */
  protected abstract assignments(descriptor: InteractionDescriptor, value: Value | null): Iterable<Assignment>;

  /** Puts the prompt, the parts of the layout and the notes in the element, as a group that the prompt names. */
  protected arrange(prompt: RenderedPrompt | undefined, ...parts: readonly Node[]): void {
    nameByPrompt(this, prompt);
    this.setAttribute("role", "group");
    this.replaceChildren(
      ...(prompt === undefined ? [] : [prompt.element]),
      ...parts,
      ...(this.notes === undefined ? [] : [this.notes.element]),
    );
  }

  protected override configure(descriptor: InteractionDescriptor, messages: Messages): void {
    const notes = this.notes;
    if (notes === undefined) return;
    const layout = this.layout(descriptor, messages);
    const board = new Board(layout.sources, layout.places);
    board.load(this.assignments(descriptor, this.value));
    this.#board = board;
    this.#view?.dispose();
    this.#view = new BoardView({
      board,
      messages,
      notes,
      root: this,
      pool: layout.pool,
      tokens: layout.tokens,
      slots: layout.slots,
      changed: () => this.#changed(),
    });
    this.#view.lock(this.disabled);
    this.#view.render();
  }

  protected override sync(descriptor: InteractionDescriptor): void {
    const board = this.#board;
    if (board === undefined) return;
    // A board with a pair half made holds more than the response does, and keeps it.
    if (!sameValue(this.toValue(descriptor, board), this.value)) {
      board.load(this.assignments(descriptor, this.value));
      this.#view?.render();
    }
    this.#view?.lock(this.disabled);
  }

  #changed(): void {
    const descriptor = this.descriptor;
    const board = this.#board;
    if (descriptor !== undefined && board !== undefined) this.respond(this.toValue(descriptor, board));
  }
}

/**
 * The element of an interaction whose response is a list of directed pairs, each a choice and the place it fills: a match,
 * a gap match or a graphic gap match.
 */
export abstract class DirectedPairElement extends BoardElement {
  protected override toValue(descriptor: InteractionDescriptor, board: Board): Value | null {
    const pairs = board.assignments().map(([place, source]): Pair => [source, place]);
    return responseOf(descriptor, "directedPair", pairs);
  }

  protected override assignments(_descriptor: InteractionDescriptor, value: Value | null): Iterable<Assignment> {
    return pairsOf(value).map(([source, place]): Assignment => [place, source]);
  }
}
