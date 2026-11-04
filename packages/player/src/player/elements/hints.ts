import type { InteractionDescriptor, ResponseViolation } from "@assesskit/runtime/interactions";
import type { Messages } from "../../messages/index.js";

/**
 * The texts that an item gives for the rules that a response breaks, in the `data-*-message` attributes of its
 * interaction: they replace the player's own text.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, interactions}
 */
export interface CustomMessages {
  /** The text for too few choices, associations or selections (`data-min-selections-message`). */
  readonly min?: string;
  /** The text for too many choices, associations or selections (`data-max-selections-message`). */
  readonly max?: string;
  /** The text for a text that the pattern mask does not match (`data-patternmask-message`). */
  readonly pattern?: string;
}

/** The kinds whose `min-choices` and `max-choices` count the choices that the candidate puts in order. */
const ORDERING: ReadonlySet<string> = new Set(["order-interaction", "graphic-order-interaction"]);

/** The reasons that a change of the candidate's cannot fix: the response itself is not one that the interaction gives. */
const UNFIXABLE: ReadonlySet<ResponseViolation> = new Set([
  "binding",
  "bounds",
  "repeated-choice",
  "step",
  "unknown-choice",
]);

/** A limit is shown to the candidate from this number on: a limit of one is the control itself, such as a radio button. */
const NOTEWORTHY_LIMIT = 2;

/** Returns a message and the number that completes it, as a sentence: `Select at most 2.` */
function counted(message: string, count: number | undefined): string {
  return count === undefined ? message : `${message} ${count}.`;
}

/** Returns the limits of choices, with the number of choices when the kind orders all of them by default. */
function choiceLimits(descriptor: InteractionDescriptor): { readonly min?: number; readonly max?: number } {
  const { minChoices, maxChoices } = descriptor.constraints;
  if (!ORDERING.has(descriptor.kind)) return { min: minChoices, max: maxChoices };
  const total = descriptor.choices.length;
  return { min: minChoices ?? total, max: minChoices === undefined ? total : (maxChoices ?? total) };
}

/** Returns the text for a limit that a response breaks, from the item's own text when it has one. */
function limitText(
  reason: ResponseViolation,
  descriptor: InteractionDescriptor,
  messages: Messages,
  custom: CustomMessages,
): string {
  const { constraints } = descriptor;
  const ordering = ORDERING.has(descriptor.kind);
  const { min, max } = choiceLimits(descriptor);
  switch (reason) {
    case "min-choices":
      return custom.min ?? counted(ordering ? messages.hintMinPlaced : messages.hintMinChoices, min);
    case "max-choices":
      return custom.max ?? counted(ordering ? messages.hintMaxPlaced : messages.hintMaxChoices, max);
    case "min-associations":
      return custom.min ?? counted(messages.hintMinAssociations, constraints.minAssociations);
    case "max-associations":
      return custom.max ?? counted(messages.hintMaxAssociations, constraints.maxAssociations);
    case "min-strings":
      return counted(messages.hintMinStrings, constraints.minStrings);
    case "max-strings":
      return counted(messages.hintMaxStrings, constraints.maxStrings);
    case "min-plays":
      return counted(messages.hintMinPlays, constraints.minPlays);
    default:
      return counted(messages.hintMaxPlays, constraints.maxPlays);
  }
}

/**
 * Returns the text that tells the candidate what to change for a rule that the response breaks (WCAG 3.3.1, 3.3.3): the
 * item's own text for the rules that have one, else the player's, which names the limit.
 *
 * @param reason - A reason of the runtime's `validateResponse`.
 * @param descriptor - The descriptor whose rules the response breaks.
 * @param messages - The text of the interface.
 * @param custom - The item's own texts; none without it.
 * @returns The text.
 */
export function violationText(
  reason: ResponseViolation,
  descriptor: InteractionDescriptor,
  messages: Messages,
  custom: CustomMessages = {},
): string {
  if (UNFIXABLE.has(reason)) return messages.hintInvalid;
  switch (reason) {
    case "required":
      return messages.hintRequired;
    case "match-min":
      return messages.hintMatchMin;
    case "match-max":
      return messages.hintMatchMax;
    case "match-group":
      return messages.hintMatchGroup;
    case "pattern-mask":
      return custom.pattern ?? messages.hintPatternMask;
    case "mime-type":
      return `${messages.hintMimeType} ${(descriptor.constraints.mimeTypes ?? []).join(", ")}`;
    default:
      return limitText(reason, descriptor, messages, custom);
  }
}

/** Returns the sentence for a limit when it is worth telling, in the cases that `instructionText` lists. */
function noteworthy(message: string, limit: number | undefined): string[] {
  return limit !== undefined && limit >= NOTEWORTHY_LIMIT ? [counted(message, limit)] : [];
}

/** Returns the sentences for the limits of choices or placements. */
function choiceInstructions(descriptor: InteractionDescriptor, messages: Messages): string[] {
  const { minChoices, maxChoices } = descriptor.constraints;
  if (ORDERING.has(descriptor.kind)) {
    // Without min-choices the candidate puts every choice in order, and the places say so.
    return minChoices === undefined
      ? []
      : [
          counted(messages.hintMinPlaced, minChoices),
          ...(maxChoices === undefined ? [] : [counted(messages.hintMaxPlaced, maxChoices)]),
        ];
  }
  return [...noteworthy(messages.hintMinChoices, minChoices), ...noteworthy(messages.hintMaxChoices, maxChoices)];
}

/**
 * Returns the limits of an interaction that the candidate cannot guess, as sentences (WCAG 3.3.2): the fewest and most
 * choices, placements, associations and texts.
 *
 * @remarks
 * A limit of one is not told, because the control shows it. The text is empty when there is nothing to tell.
 *
 * @param descriptor - The descriptor of the interaction.
 * @param messages - The text of the interface.
 * @returns The sentences, or the empty text when there is nothing to tell.
 */
export function instructionText(descriptor: InteractionDescriptor, messages: Messages): string {
  const { minAssociations, maxAssociations, minStrings, maxStrings } = descriptor.constraints;
  return [
    ...choiceInstructions(descriptor, messages),
    ...noteworthy(messages.hintMinAssociations, minAssociations),
    ...noteworthy(messages.hintMaxAssociations, maxAssociations),
    ...noteworthy(messages.hintMinStrings, minStrings),
    ...noteworthy(messages.hintMaxStrings, maxStrings),
  ].join(" ");
}
