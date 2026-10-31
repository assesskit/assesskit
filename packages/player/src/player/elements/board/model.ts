/** A choice that the candidate puts in places, and how many times it may be put (a `match-max`, INFO §5.131.6). */
export interface BoardSource {
  /** The identifier of the choice. */
  readonly id: string;
  /** The most places that hold it at once; `Number.POSITIVE_INFINITY` for no limit. */
  readonly limit: number;
}

/** A place that holds choices, and how many it holds. */
export interface BoardPlace {
  /** The identifier of the place: a gap, a target or the position in an order. */
  readonly id: string;
  /** The most choices it holds at once; `Number.POSITIVE_INFINITY` for no limit. */
  readonly capacity: number;
}

/** A choice in a place. */
export type Assignment = readonly [place: string, source: string];

/**
 * Which choices are in which places: the state of the board that an order, an association, a match and a gap match are
 * drawn on. It knows the capacity of each place and how often each choice may be used, and nothing of the kinds of
 * interaction that map it to a response.
 */
export class Board {
  readonly #sources: ReadonlyMap<string, BoardSource>;
  readonly #places: ReadonlyMap<string, BoardPlace>;
  readonly #occupants: Map<string, string[]>;

  /**
   * @param sources - The choices that can be put in places.
   * @param places - The places, in the order the response lists them.
   */
  constructor(sources: Iterable<BoardSource>, places: Iterable<BoardPlace>) {
    this.#sources = new Map([...sources].map((source) => [source.id, source]));
    this.#places = new Map([...places].map((place) => [place.id, place]));
    this.#occupants = new Map([...this.#places.keys()].map((id) => [id, []]));
  }

  /** Returns the choices in a place, in the order they were put there. */
  occupants(place: string): readonly string[] {
    return this.#occupants.get(place) ?? [];
  }

  /** Returns how many places hold a choice. */
  uses(source: string): number {
    let count = 0;
    for (const occupants of this.#occupants.values()) count += occupants.filter((id) => id === source).length;
    return count;
  }

  /** Returns how many more times a choice may be put in a place. */
  remaining(source: string): number {
    return (this.#sources.get(source)?.limit ?? 0) - this.uses(source);
  }

  /** Returns whether a place holds as many choices as it can. */
  isFull(place: string): boolean {
    return this.occupants(place).length >= (this.#places.get(place)?.capacity ?? 0);
  }

  /**
   * Puts a choice in a place. A choice that comes from another place moves; a choice from the pool needs a use left. A
   * place that is full gives up its first choice, which goes back to the pool.
   *
   * @param from - The place the choice leaves. Default: none, so that the choice comes from the pool.
   * @returns Whether the choice was put in the place.
   */
  put(source: string, place: string, from?: string): boolean {
    const target = this.#occupants.get(place);
    if (target === undefined || !this.#sources.has(source) || from === place) return false;
    if (from === undefined && this.remaining(source) < 1) return false;
    if (from !== undefined && !this.take(source, from)) return false;
    if (this.isFull(place)) target.shift();
    target.push(source);
    return true;
  }

  /** Takes a choice out of a place; returns whether it was there. */
  take(source: string, place: string): boolean {
    const occupants = this.#occupants.get(place);
    const index = occupants?.indexOf(source) ?? -1;
    if (index < 0) return false;
    occupants?.splice(index, 1);
    return true;
  }

  /**
   * Replaces the state with the given assignments, in order. An assignment of an unknown place or choice, or past what
   * the place or the choice allows, is left out.
   */
  load(assignments: Iterable<Assignment>): void {
    for (const occupants of this.#occupants.values()) occupants.length = 0;
    for (const [place, source] of assignments) {
      if (!this.isFull(place) && this.remaining(source) >= 1) this.#occupants.get(place)?.push(source);
    }
  }

  /** Returns every choice in a place, by place in the order of the places. */
  assignments(): readonly Assignment[] {
    return [...this.#occupants].flatMap(([place, occupants]) => occupants.map((source): Assignment => [place, source]));
  }
}
