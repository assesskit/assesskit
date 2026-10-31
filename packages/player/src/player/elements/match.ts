import type { MatchInteraction } from "@assesskit/runtime/asi";
import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import type { Pair, Value } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html, uniqueId } from "../dom.js";
import type { Assignment, Board } from "./board/model.js";
import { BoardElement, type BoardLayout, limitsOf, tokensOf } from "./board-element.js";
import { createInteraction } from "./element.js";
import { Notes } from "./notes.js";
import { type BuiltChoice, buildChoice, choiceName, type RenderedPrompt, renderPrompt } from "./parts.js";
import { pairsOf, responseOf } from "./values.js";

/** One of the two sets of a match: its element and its choices. */
interface MatchSet {
  readonly element: Element;
  readonly choices: BuiltChoice[];
}

/**
 * The element of `qti-match-interaction` (INFO §5.89): the candidate matches the choices of the first set with those of
 * the second, and not within a set. Each choice takes as many matches as its `match-max` allows (INFO §5.131.6). The
 * response is the directed pairs from the first set to the second.
 *
 * A match is drawn as a board, the choices of the first set in the pool and those of the second as the places that take
 * them, or, with the class `qti-match-tabular`, as a table with a checkbox for each match (VOCAB §1.2.8.2).
 */
export class MatchInteractionElement extends BoardElement {
  override readonly kind = "match-interaction";
  readonly #sets: MatchSet[] = [];
  #prompt: RenderedPrompt | undefined;
  #header: string | undefined;
  #cells: HTMLInputElement[] = [];

  /** Fills the element with the prompt and the two sets of the node. */
  build(node: MatchInteraction, renderer: BodyRenderer): void {
    this.#prompt = renderPrompt(node.prompt, renderer);
    for (const set of node.simpleMatchSets) {
      this.#sets.push({
        element: renderer.element("qti-simple-match-set", set, []),
        choices: set.simpleAssociableChoices.map((choice) =>
          buildChoice(renderer, "qti-simple-associable-choice", choice, renderer.nodes(choice.children)),
        ),
      });
    }
    this.#header = node.dataFirstColumnHeader;
    this.custom = { min: node.dataMinSelectionsMessage, max: node.dataMaxSelectionsMessage };
    this.notes = new Notes();
  }

  get #tabular(): boolean {
    return this.classList.contains("qti-match-tabular");
  }

  protected override configure(descriptor: InteractionDescriptor, messages: Messages): void {
    if (this.#tabular) this.#configureTable(messages);
    else super.configure(descriptor, messages);
  }

  protected override sync(descriptor: InteractionDescriptor): void {
    if (!this.#tabular) {
      super.sync(descriptor);
      return;
    }
    const matches = new Set(pairsOf(this.value).map(([source, target]) => `${source}\0${target}`));
    for (const cell of this.#cells) {
      cell.checked = matches.has(`${cell.dataset.akSource}\0${cell.dataset.akTarget}`);
      cell.disabled = this.disabled;
    }
  }

  protected override controls(): readonly Element[] {
    return this.#tabular ? this.#cells : [this];
  }

  protected override layout(descriptor: InteractionDescriptor, messages: Messages): BoardLayout {
    const [first, second] = this.#sets;
    const limitOf = limitsOf(descriptor);
    const slots = (second?.choices ?? []).map((choice, index) => {
      const name = choiceName(choice.name, index, messages);
      choice.element.classList.add("ak-target");
      choice.element.setAttribute("role", "group");
      choice.element.setAttribute("aria-label", name);
      choice.element.replaceChildren(html("div", { class: "ak-target-content" }, ...choice.content));
      return { id: choice.id, element: choice.element, name };
    });
    const pool = first?.element ?? html("div");
    pool.classList.add("ak-choices");
    pool.setAttribute("role", "group");
    pool.setAttribute("aria-label", messages.boardChoices);
    pool.replaceChildren(...(first?.choices ?? []).map(({ element }) => element));
    const targets = second?.element ?? html("div");
    targets.classList.add("ak-targets");
    targets.replaceChildren(...slots.map(({ element }) => element));
    this.arrange(this.#prompt, pool, targets);
    return {
      sources: (first?.choices ?? []).map(({ id }) => ({ id, limit: limitOf(id) })),
      places: slots.map(({ id }) => ({ id, capacity: limitOf(id) })),
      tokens: tokensOf(first?.choices ?? [], messages),
      slots,
      pool,
    };
  }

  protected override toValue(descriptor: InteractionDescriptor, board: Board): Value | null {
    const pairs = board.assignments().map(([target, source]): Pair => [source, target]);
    return responseOf(descriptor, "directedPair", pairs);
  }

  protected override assignments(_descriptor: InteractionDescriptor, value: Value | null): Iterable<Assignment> {
    return pairsOf(value).map(([source, target]): Assignment => [target, source]);
  }

  /** Draws the match as a table: the first set in the rows, the second in the columns, a checkbox where they meet. */
  #configureTable(messages: Messages): void {
    const [rows = [], columns = []] = this.#sets.map(({ choices }) => choices);
    const header = html(
      "th",
      { scope: "col" },
      ...(this.#header === undefined
        ? [html("span", { class: "qti-visually-hidden" }, messages.boardChoices)]
        : [this.#header]),
    );
    const columnHeads = columns.map((column) =>
      html("th", { scope: "col", id: uniqueId("ak-column") }, ...column.content),
    );
    this.#cells = [];
    const body = rows.map((row) => {
      const head = html("th", { scope: "row", id: uniqueId("ak-row") }, ...row.content);
      const cells = columns.map((column, index) => {
        const cell = html("input", {
          type: "checkbox",
          "aria-labelledby": `${head.id} ${columnHeads[index]?.id ?? ""}`,
        });
        cell.dataset.akSource = row.id;
        cell.dataset.akTarget = column.id;
        cell.addEventListener("change", () => this.#choose());
        this.#cells.push(cell);
        return html("td", {}, cell);
      });
      return html("tr", {}, head, ...cells);
    });
    const table = html(
      "table",
      {},
      html("thead", {}, html("tr", {}, header, ...columnHeads)),
      html("tbody", {}, ...body),
    );
    this.arrange(this.#prompt, table);
  }

  #choose(): void {
    const descriptor = this.descriptor;
    if (descriptor === undefined) return;
    const pairs = this.#cells.flatMap((cell): Pair[] =>
      cell.checked ? [[cell.dataset.akSource ?? "", cell.dataset.akTarget ?? ""]] : [],
    );
    this.respond(responseOf(descriptor, "directedPair", pairs));
  }
}

/** Renders a `qti-match-interaction`. */
export function renderMatch(node: MatchInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(MatchInteractionElement, "qti-match-interaction", node, renderer, messages);
  element.build(node, renderer);
  return element;
}
