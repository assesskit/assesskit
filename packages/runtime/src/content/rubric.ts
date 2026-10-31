import type { AssessmentSection, AssessmentTest, RubricBlock, TestPart, TestRubricBlock } from "../asi/index.js";
import { checkArray, checkChoice, checkRecord } from "../checks.js";

/** Every view of a rubric block: the actor that it is shown to (INFO §9.2.2 `ViewEnum`). */
export const VIEWS = ["author", "candidate", "proctor", "scorer", "testConstructor", "tutor"] as const;

/** A view of a rubric block: author, candidate, proctor, scorer, testConstructor or tutor. */
export type View = (typeof VIEWS)[number];

/**
 * Returns the rubric blocks that are shown in a view (INFO §2.8.6, §5.120.2, §5.160.1): those whose `view` lists it. The
 * blocks of a test, test part or section, and those of an item body, work alike.
 *
 * @param blocks - The rubric blocks.
 * @param view - The view.
 * @returns The blocks that list the view, in the order given.
 * @throws `DataError` when `blocks` is not an array of rubric blocks or `view` is not a view.
 */
export function rubricBlocksFor<T extends RubricBlock | TestRubricBlock>(
  blocks: readonly T[],
  view: View,
): readonly T[] {
  checkArray(blocks, "The rubric blocks must be an array");
  checkChoice(view, "The view", VIEWS);
  return blocks.filter((block) => {
    checkRecord(block, "A rubric block must be an object");
    checkArray(block.view, "The view of a rubric block must be an array");
    return block.view.includes(view);
  });
}

/** Where the candidate is in a test: the test, its test part, and the sections from the top down to the current one. */
export interface TestPosition {
  /** The test. */
  readonly test: AssessmentTest;
  /** The test part the candidate is in. Default: none, so that the rubric is that of the test alone. */
  readonly part?: TestPart;
  /** The sections that contain the current item or section, from the outermost down. Default: none. */
  readonly sections?: readonly AssessmentSection[];
}

/**
 * Returns the rubric blocks of a test that a view sees at a position, in the order the candidate meets them: the blocks
 * of the test, then those of the test part, then those of the sections from the top section down (INFO §2.8.6, §5.159.11,
 * F-m25). Each level keeps its own order.
 *
 * @param position - The test, and the test part and sections that contain the candidate.
 * @param view - The view.
 * @returns The `qti-rubric-block`s of the levels whose `view` lists the view.
 * @throws `DataError` when an argument has the wrong type.
 */
export function testRubricBlocks(position: TestPosition, view: View): readonly TestRubricBlock[] {
  checkRecord(position, "The position must be an object with a test and optionally a part and sections");
  const { test, part, sections = [] } = position;
  checkRecord(test, "The test must be an object of the model of qti-assessment-test");
  checkArray(sections, "The sections must be an array");
  return [
    ...rubricBlocksFor(test.rubricBlocks, view),
    ...(part === undefined ? [] : rubricBlocksFor(part.rubricBlocks, view)),
    ...sections.flatMap((section) => rubricBlocksFor(section.rubricBlocks, view)),
  ];
}
