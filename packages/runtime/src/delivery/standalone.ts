import type { AssessmentItem, AssessmentTest } from "../asi/index.js";
import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import { isIdentifier } from "../values/index.js";
import { resolveStructure, type TestStructure } from "./structure.js";

/**
 * Returns the structure of a test that delivers one item alone: the test, named as the item, has one nonlinear test
 * part with individual submission, `<identifier>-part`, holding one section, `<identifier>-section`, whose one item
 * reference has the identifier of the item.
 *
 * @remarks
 * The test is the model that `readAsi` makes of that document, built directly, so that the engine does not load the reader
 * of XML documents.
 *
 * @throws `DataError` when the identifier of the item is not an identifier.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function standaloneTest(item: AssessmentItem): TestStructure {
  const id = item.identifier;
  if (!isIdentifier(id)) throw new DataError(`The item must have an identifier, found ${describe(id)}.`);
  const test: AssessmentTest = {
    kind: "assessment-test",
    identifier: id,
    title: id,
    extensions: [],
    contextDeclarations: [],
    outcomeDeclarations: [],
    stylesheets: [],
    rubricBlocks: [],
    testParts: [
      {
        kind: "test-part",
        identifier: `${id}-part`,
        navigationMode: "nonlinear",
        submissionMode: "individual",
        extensions: [],
        preConditions: [],
        branchRules: [],
        rubricBlocks: [],
        sections: [
          {
            kind: "assessment-section",
            identifier: `${id}-section`,
            title: id,
            visible: true,
            extensions: [],
            preConditions: [],
            branchRules: [],
            rubricBlocks: [],
            children: [
              {
                kind: "assessment-item-ref",
                identifier: id,
                href: id,
                extensions: [],
                preConditions: [],
                branchRules: [],
                variableMappings: [],
                weights: [],
                templateDefaults: [],
              },
            ],
          },
        ],
        testFeedback: [],
      },
    ],
    testFeedback: [],
  };
  return resolveStructure(test, id, {
    sections: () => {
      throw new DataError(`The test of the item ${id} has no section reference.`);
    },
  });
}
