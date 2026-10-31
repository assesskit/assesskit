import type { TestPart } from "../asi/index.js";
import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { Placement } from "./plan-index.js";
import type { TestStructure } from "./structure.js";

/** Returns the test part that holds an item instance. */
export function partModel(structure: TestStructure, placement: Pick<Placement, "part">): TestPart {
  const part = structure.part(placement.part);
  if (part === undefined)
    throw new DataError(`The plan names ${describe(placement.part)}, which the test does not have.`);
  return part.model;
}

/**
 * Returns how an item instance is submitted: the mode of its test part, except that the items of an adaptive section
 * are processed one by one in a part of either mode.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export function submissionModeOf(structure: TestStructure, placement: Placement): "individual" | "simultaneous" {
  const adaptive = placement.sections.some(
    (section) => structure.section(section.identifier)?.model.adaptiveSelection !== undefined,
  );
  return adaptive ? "individual" : partModel(structure, placement).submissionMode;
}
