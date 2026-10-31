import { ASI_NAMESPACE, type AssessmentItem, readAsi } from "../asi/index.js";
import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import { isIdentifier } from "../values/index.js";

/**
 * Returns the item that models a link to a tool: no response variables, and the outcomes `SCORE` and `MAXSCORE`, single
 * floats that the tool scores (`external-scored="externalMachine"`).
 *
 * @remarks
 * The item has the identifier of the manifest resource of the link.
 *
 * @throws `DataError` when the identifier of the resource is not an identifier.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function ltiItem(identifier: string): AssessmentItem {
  if (!isIdentifier(identifier)) {
    throw new DataError(`The resource of a link to a tool must have an identifier, found ${describe(identifier)}.`);
  }
  const document =
    readAsi(`<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="${identifier}" title="${identifier}" time-dependent="false">
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="externalMachine"/>
  <qti-outcome-declaration identifier="MAXSCORE" cardinality="single" base-type="float" external-scored="externalMachine"/>
</qti-assessment-item>`);
  if (document.kind !== "item") throw new DataError(`The model of the link ${identifier} is not an item.`);
  return document.item;
}
