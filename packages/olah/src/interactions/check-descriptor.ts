import { checkArray, checkBoolean, checkRecord, checkString } from "../checks.js";
import type { ChoiceDescriptor, InteractionDescriptor } from "./descriptor.js";

function checkChoice(choice: unknown): asserts choice is ChoiceDescriptor {
  checkRecord(choice, "A choice of an interaction descriptor must be an object");
  checkString(choice.identifier, "The identifier of a choice");
  checkBoolean(choice.fixed, "The property fixed of a choice");
}

function checkChoices(choices: unknown, label: string): void {
  checkArray(choices, `${label} must be an array`);
  for (const choice of choices) checkChoice(choice);
}

/**
 * Checks an interaction descriptor: the properties that the functions of this module read, which are the kind, the
 * response identifier, the bindings, the choices and their sets, the constraints and `shuffle`.
 *
 * @throws `DataError` when it is not a descriptor.
 */
export function checkDescriptor(descriptor: unknown): asserts descriptor is InteractionDescriptor {
  checkRecord(descriptor, "The interaction descriptor must be an object");
  checkString(descriptor.kind, "The kind of an interaction descriptor");
  checkString(descriptor.responseIdentifier, "The response identifier of an interaction descriptor");
  checkArray(descriptor.bindings, "The bindings of an interaction descriptor must be an array");
  checkChoices(descriptor.choices, "The choices of an interaction descriptor");
  if (descriptor.matchSets !== undefined) {
    checkArray(descriptor.matchSets, "The match sets of an interaction descriptor must be an array");
    for (const set of descriptor.matchSets) checkChoices(set, "A match set of an interaction descriptor");
  }
  checkRecord(descriptor.constraints, "The constraints of an interaction descriptor must be an object");
  checkBoolean(descriptor.shuffle, "The property shuffle of an interaction descriptor");
}
