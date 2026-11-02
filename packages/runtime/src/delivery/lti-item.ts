import type { AssessmentItem, OutcomeDeclaration } from "../asi/index.js";
import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import { isIdentifier } from "../values/index.js";

/** An outcome of a link to a tool: a single float that the tool scores. */
const toolScored = (identifier: string): OutcomeDeclaration => ({
  kind: "outcome-declaration",
  identifier,
  cardinality: "single",
  baseType: "float",
  externalScored: "externalMachine",
});

/**
 * Returns the item that models a link to a tool: no response variables, and the outcomes `SCORE` and `MAXSCORE`, single
 * floats that the tool scores (`external-scored="externalMachine"`).
 *
 * @remarks
 * The item has the identifier of the manifest resource of the link. It is the model that `readAsi` makes of that document,
 * built directly, so that the engine does not load the reader of XML documents.
 *
 * @throws `DataError` when the identifier of the resource is not an identifier.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function ltiItem(identifier: string): AssessmentItem {
  if (!isIdentifier(identifier)) {
    throw new DataError(`The resource of a link to a tool must have an identifier, found ${describe(identifier)}.`);
  }
  return {
    kind: "assessment-item",
    identifier,
    title: identifier,
    timeDependent: false,
    extensions: [],
    contextDeclarations: [],
    responseDeclarations: [],
    outcomeDeclarations: [toolScored("SCORE"), toolScored("MAXSCORE")],
    templateDeclarations: [],
    stimulusRefs: [],
    stylesheets: [],
    modalFeedback: [],
  };
}
