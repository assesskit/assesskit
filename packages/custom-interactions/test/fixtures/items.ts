import { type AssessmentItem, readAsi, writeAsi } from "@assesskit/runtime/asi";
import type { ExpressionKey } from "@assesskit/runtime/keys";
import { compileScoring } from "@assesskit/runtime/scoring";
import { INTERACTION_TYPES } from "../../src/index.js";

const NS = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';

/** Reads the item of a document that the test writes. */
function itemOf(xml: string): AssessmentItem {
  const document = readAsi(xml);
  if (document.kind !== "item") throw new Error("The test writes an item.");
  return document.item;
}

/** The body of an item with the math entry interaction, its module in the package's `modules/`, and the given attributes. */
function mathEntryBody(prompt: string, attributes: string): string {
  return `<qti-item-body>
    <qti-portable-custom-interaction response-identifier="RESPONSE" module="math-entry"
        custom-interaction-type-identifier="${INTERACTION_TYPES["math-entry"]}" ${attributes}>
      <qti-prompt>${prompt}</qti-prompt>
      <qti-interaction-modules>
        <qti-interaction-module id="math-entry" primary-path="modules/math-entry"/>
      </qti-interaction-modules>
      <qti-interaction-markup/>
    </qti-portable-custom-interaction>
  </qti-item-body>`;
}

/**
 * Writes an item that asks for an expression with the math entry interaction and scores it by its key, with the response
 * declaration and the response processing of `compileScoring`, as an author's tool writes it.
 *
 * @param key - The key of the response.
 * @param prompt - The prompt, which names the frame.
 * @param attributes - More attributes of the interaction, such as `data-decimal-separator=","`.
 */
export function writeMathEntryItem(key: ExpressionKey, prompt: string, attributes = ""): string {
  const scoring = compileScoring([{ identifier: "RESPONSE", key }]);
  const shell = itemOf(`<qti-assessment-item ${NS} identifier="math-entry" title="Math entry" adaptive="false"
      time-dependent="false">${mathEntryBody(prompt, attributes)}</qti-assessment-item>`);
  const { responseDeclarations, outcomeDeclarations, responseProcessing } = scoring;
  return writeAsi({ kind: "item", item: { ...shell, responseDeclarations, outcomeDeclarations, responseProcessing } });
}

/**
 * Writes an item that asks for worked steps with the math entry interaction: an `ordered` response of strings, which a
 * rater of steps scores, so the item has no response processing of its own.
 *
 * @param prompt - The prompt, which names the frame.
 */
export function writeStepsItem(prompt: string): string {
  return writeAsi({
    kind: "item",
    item: itemOf(`<qti-assessment-item ${NS} identifier="math-steps" title="Worked steps" adaptive="false"
        time-dependent="false">
      <qti-response-declaration identifier="RESPONSE" cardinality="ordered" base-type="string"/>
      ${mathEntryBody(prompt, "")}
    </qti-assessment-item>`),
  });
}

/** Reads the one interaction of an item that the fixtures write, and the declaration of its response. */
export function interactionOf(xml: string) {
  const item = itemOf(xml);
  const [node] = item.body?.children ?? [];
  if (node?.kind !== "portable-custom-interaction") throw new Error("The item has no portable custom interaction.");
  const declaration = item.responseDeclarations.find(({ identifier }) => identifier === node.responseIdentifier);
  if (declaration === undefined) throw new Error("The item declares no response for its interaction.");
  return { item, interaction: node, declaration };
}
