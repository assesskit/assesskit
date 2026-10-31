import { ASI_NAMESPACE, type AssessmentItem, readAsi } from "../asi/index.js";
import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import { isIdentifier } from "../values/index.js";
import { resolveStructure, type TestStructure } from "./structure.js";

/**
 * Returns the structure of a test that delivers one item alone: the test, named as the item, has one nonlinear test
 * part with individual submission, `<identifier>-part`, holding one section, `<identifier>-section`, whose one item
 * reference has the identifier of the item.
 *
 * @throws `DataError` when the identifier of the item is not an identifier.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function standaloneTest(item: AssessmentItem): TestStructure {
  const id = item.identifier;
  if (!isIdentifier(id)) throw new DataError(`The item must have an identifier, found ${describe(id)}.`);
  const document = readAsi(`<qti-assessment-test xmlns="${ASI_NAMESPACE}" identifier="${id}" title="${id}">
  <qti-test-part identifier="${id}-part" navigation-mode="nonlinear" submission-mode="individual">
    <qti-assessment-section identifier="${id}-section" title="${id}" visible="true">
      <qti-assessment-item-ref identifier="${id}" href="${id}"/>
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`);
  if (document.kind !== "test") throw new DataError(`The test of the item ${id} is not a test.`);
  return resolveStructure(document.test, id, {
    sections: () => {
      throw new DataError(`The test of the item ${id} has no section reference.`);
    },
  });
}
