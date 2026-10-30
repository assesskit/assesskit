import { checkArray, checkFunction, checkRecord, checkString } from "../checks.js";
import { DataError } from "../errors.js";
import { type Random, shuffle } from "../random.js";
import { checkDescriptor } from "./check-descriptor.js";
import type { ChoiceDescriptor, InteractionDescriptor } from "./descriptor.js";

/** The sets of choices that an order lists: the sets of a pairing interaction, else all the choices as one set. */
function setsOf(descriptor: InteractionDescriptor): readonly (readonly ChoiceDescriptor[])[] {
  if (descriptor.matchSets !== undefined) return descriptor.matchSets;
  return descriptor.choices.length === 0 ? [] : [descriptor.choices];
}

/**
 * Returns how many of the sets a shuffle permutes. A match interaction shuffles each of its two sets (INFO §5.89.1); a
 * gap match interaction shuffles its choices and not its gaps (INFO §5.57.1), and so does a graphic gap match
 * interaction for its choices and hotspots.
 */
function shuffledSets(descriptor: InteractionDescriptor): number {
  return descriptor.kind === "match-interaction" ? 2 : 1;
}

/**
 * Draws the initial order of the choices of an interaction. The result has one list of identifiers for each set of
 * choices: the single set of most interactions, the two sets of a match interaction, and the choices and the gaps or
 * hotspots of a gap match and a graphic gap match interaction (the `matchSets` of the descriptor).
 *
 * When `shuffle` is true, each shuffled set is permuted by Fisher–Yates from the last index with the draw procedure
 * of olah: for a set of n movable choices, one draw `floor(uniform() × (i + 1))` for i from n − 1 down to 1 (INFO
 * §5.30.1). The sets are shuffled one after the other, and a choice with `fixed` keeps its position among all the
 * choices of its set. Choices that a template variable hides are shuffled with the rest and dropped afterward, so that
 * the positions of fixed choices hold (G19, INFO §2.7.1); {@link presentChoices} drops them. Without `shuffle` the
 * order is the order of the document, and no number is drawn.
 *
 * @param descriptor - The descriptor of the interaction, with every choice.
 * @param random - The source of the draws. Equal draws give equal orders.
 * @returns The identifiers of each set in the order of presentation; none for an interaction without choices.
 * @throws `DataError` when an argument has the wrong type, or the source returns anything but a number in [0, 1).
 */
export function shuffleChoices(descriptor: InteractionDescriptor, random: Random): readonly (readonly string[])[] {
  checkDescriptor(descriptor);
  checkRecord(random, "The random source must be an object with a function uniform");
  checkFunction(random.uniform, "The random source must be an object with a function uniform");
  const permuted = descriptor.shuffle ? shuffledSets(descriptor) : 0;
  return setsOf(descriptor).map((set, place) =>
    (place < permuted ? shuffle(set, (choice) => choice.fixed, random) : set).map((choice) => choice.identifier),
  );
}

function reorder(set: readonly ChoiceDescriptor[], order: unknown, place: number): ChoiceDescriptor[] {
  checkArray(order, `The order of the set ${place + 1} of choices must be an array`);
  const byIdentifier = new Map(set.map((choice) => [choice.identifier, choice]));
  const seen = new Set<string>();
  return order.map((identifier) => {
    checkString(identifier, `An identifier in the order of the set ${place + 1} of choices`);
    const choice = byIdentifier.get(identifier);
    if (choice === undefined || seen.has(identifier)) {
      const problem = choice === undefined ? "is not a choice of the set" : "occurs twice";
      throw new DataError(
        `The order of the set ${place + 1} of choices names ${JSON.stringify(identifier)}, which ${problem}.`,
      );
    }
    seen.add(identifier);
    return choice;
  });
}

/**
 * Returns a descriptor with its choices as presented to the candidate: each set in the given order, and the choices an
 * order does not name dropped, such as those that template variables hide. Taking the orders from
 * {@link shuffleChoices} and removing the hidden identifiers is how an interaction is presented the first time, and the
 * stored orders give the same descriptor again when a session resumes.
 *
 * @param descriptor - The descriptor of the interaction, with every choice.
 * @param orders - One list of identifiers for each set of choices, as {@link shuffleChoices} returns them; each names a
 * choice of its set at most once.
 * @throws `DataError` when an argument has the wrong type, `orders` does not have one list for each set, or a list names
 * something that is not a choice of its set, or names a choice twice.
 */
export function presentChoices(
  descriptor: InteractionDescriptor,
  orders: readonly (readonly string[])[],
): InteractionDescriptor {
  checkDescriptor(descriptor);
  checkArray(orders, "The orders must be an array with one list of identifiers for each set of choices");
  const sets = setsOf(descriptor);
  if (orders.length !== sets.length) {
    throw new DataError(
      `The orders must have one list for each of the ${sets.length} sets of choices, found ${orders.length}.`,
    );
  }
  const presented = sets.map((set, place) => reorder(set, orders[place], place));
  return {
    ...descriptor,
    choices: presented.flat(),
    ...(descriptor.matchSets === undefined ? {} : { matchSets: presented }),
  };
}
