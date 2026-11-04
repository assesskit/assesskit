import fc from "fast-check";
import type { ChoiceDescriptor, InteractionDescriptor, InteractionKind } from "../../src/interactions/index.js";

/** A choice descriptor with the identifier, which is fixed or free. */
const choiceOf = (identifier: string, fixed: boolean): ChoiceDescriptor => ({ identifier, fixed, showHide: "show" });

/** Between 0 and `size` flags, one for each choice. */
const flags = (size: number): fc.Arbitrary<boolean[]> => fc.array(fc.boolean(), { minLength: size, maxLength: size });

/** A list of `size` choices that are fixed or free, with identifiers that start with `prefix`. */
function choices(prefix: string, size: fc.Arbitrary<number>): fc.Arbitrary<ChoiceDescriptor[]> {
  return size
    .chain((count) => flags(count))
    .map((fixed) => fixed.map((isFixed, place) => choiceOf(`${prefix}${place}`, isFixed)));
}

function descriptorOf(
  kind: InteractionKind,
  sets: readonly (readonly ChoiceDescriptor[])[],
  shuffle: boolean,
): InteractionDescriptor {
  const pairs = kind === "match-interaction" || kind === "gap-match-interaction";
  return {
    kind,
    responseIdentifier: "RESPONSE",
    bindings: [],
    choices: sets.flat(),
    ...(pairs ? { matchSets: sets } : {}),
    constraints: {},
    shuffle,
  };
}

/** A choice interaction, an order interaction, a match interaction or a gap match interaction, shuffling or not. */
export const shufflingDescriptor: fc.Arbitrary<InteractionDescriptor> = fc.oneof(
  fc
    .tuple(
      fc.constantFrom<InteractionKind>("choice-interaction", "order-interaction"),
      choices("C", fc.nat(8)),
      fc.boolean(),
    )
    .map(([kind, set, shuffle]) => descriptorOf(kind, [set], shuffle)),
  fc
    .tuple(
      fc.constantFrom<InteractionKind>("match-interaction", "gap-match-interaction"),
      choices("S", fc.nat(6)),
      choices("T", fc.nat(6)),
      fc.boolean(),
    )
    .map(([kind, first, second, shuffle]) => descriptorOf(kind, [first, second], shuffle)),
);
