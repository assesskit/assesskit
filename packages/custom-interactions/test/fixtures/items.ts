import { type AssessmentItem, readAsi, writeAsi } from "@assesskit/runtime/asi";
import type { ExpressionKey } from "@assesskit/runtime/keys";
import { compileScoring } from "@assesskit/runtime/scoring";
import { PCI_TYPE_IDENTIFIERS } from "../../src/index.js";

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
        custom-interaction-type-identifier="${PCI_TYPE_IDENTIFIERS["math-entry"]}" ${attributes}>
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

/** The response processing of stroke writing: 1 for every stroke written without a mistake, 0.5 with one or two, else 0. */
const STROKE_SCORING = `<qti-response-processing>
  <qti-response-condition>
    <qti-response-if>
      <qti-is-null><qti-variable identifier="RESPONSE"/></qti-is-null>
      <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">0</qti-base-value></qti-set-outcome-value>
    </qti-response-if>
    <qti-response-else-if>
      <qti-and>
        <qti-equal tolerance-mode="exact">
          <qti-field-value field-identifier="strokes"><qti-variable identifier="RESPONSE"/></qti-field-value>
          <qti-variable identifier="STROKES"/>
        </qti-equal>
        <qti-equal tolerance-mode="exact">
          <qti-field-value field-identifier="mistakes"><qti-variable identifier="RESPONSE"/></qti-field-value>
          <qti-base-value base-type="integer">0</qti-base-value>
        </qti-equal>
      </qti-and>
      <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value>
    </qti-response-else-if>
    <qti-response-else-if>
      <qti-and>
        <qti-equal tolerance-mode="exact">
          <qti-field-value field-identifier="strokes"><qti-variable identifier="RESPONSE"/></qti-field-value>
          <qti-variable identifier="STROKES"/>
        </qti-equal>
        <qti-lte>
          <qti-field-value field-identifier="mistakes"><qti-variable identifier="RESPONSE"/></qti-field-value>
          <qti-base-value base-type="integer">2</qti-base-value>
        </qti-lte>
      </qti-and>
      <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">0.5</qti-base-value></qti-set-outcome-value>
    </qti-response-else-if>
    <qti-response-else>
      <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">0</qti-base-value></qti-set-outcome-value>
    </qti-response-else>
  </qti-response-condition>
</qti-response-processing>`;

/**
 * Writes an item that asks for the character 十 with the stroke writing interaction, its character module at
 * `modules/characters/5341`, and scores the record `{ strokes, mistakes }` with QTI's own expressions.
 *
 * @param prompt - The prompt, which names the frame.
 * @param attributes - More attributes of the interaction, such as `data-show-outline="false"`.
 */
export function writeStrokeWritingItem(prompt: string, attributes = ""): string {
  return writeAsi({
    kind: "item",
    item: itemOf(`<qti-assessment-item ${NS} identifier="stroke-writing" title="Stroke writing" adaptive="false"
        time-dependent="false">
      <qti-response-declaration identifier="RESPONSE" cardinality="record"/>
      <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float">
        <qti-default-value><qti-value>0</qti-value></qti-default-value>
      </qti-outcome-declaration>
      <qti-outcome-declaration identifier="MAXSCORE" cardinality="single" base-type="float">
        <qti-default-value><qti-value>1</qti-value></qti-default-value>
      </qti-outcome-declaration>
      <qti-outcome-declaration identifier="STROKES" cardinality="single" base-type="integer">
        <qti-default-value><qti-value>2</qti-value></qti-default-value>
      </qti-outcome-declaration>
      <qti-item-body>
        <qti-portable-custom-interaction response-identifier="RESPONSE" module="stroke-writing"
            custom-interaction-type-identifier="${PCI_TYPE_IDENTIFIERS["stroke-writing"]}" ${attributes}>
          <qti-prompt>${prompt}</qti-prompt>
          <qti-interaction-modules>
            <qti-interaction-module id="stroke-writing" primary-path="modules/stroke-writing"/>
            <qti-interaction-module id="stroke-writing-character" primary-path="modules/characters/5341"/>
          </qti-interaction-modules>
          <qti-interaction-markup/>
        </qti-portable-custom-interaction>
      </qti-item-body>
      ${STROKE_SCORING}
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
