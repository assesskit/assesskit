import type { AssessmentItem } from "../src/asi/index.js";
import { readAsi } from "../src/asi/index.js";
import { compileScoring } from "../src/scoring/index.js";

// Items of the scoring rules, interactions and content that a writer meets, one rule each, for the tests of the losses.

const NS = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';
const T = "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates";
const SCORE = `<qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>`;
const MAP = `<qti-response-processing template="${T}/map_response.xml"/>`;
const CORRECT = `<qti-response-processing template="${T}/match_correct.xml"/>`;

/** An item of the given content, read by `readAsi`. */
function ruleItem(identifier: string, inner: string): AssessmentItem {
  const document = readAsi(
    `<qti-assessment-item ${NS} identifier="${identifier}" title="${identifier}" adaptive="false" time-dependent="false">${inner}</qti-assessment-item>`,
  );
  if (document.kind !== "item") throw new Error("Not an item.");
  return document.item;
}

function declare(cardinality: string, baseType: string, inner = ""): string {
  return `<qti-response-declaration identifier="RESPONSE" cardinality="${cardinality}" base-type="${baseType}">${inner}</qti-response-declaration>`;
}

function correct(...values: string[]): string {
  return `<qti-correct-response>${values.map((value) => `<qti-value>${value}</qti-value>`).join("")}</qti-correct-response>`;
}

function mapping(entries: readonly (readonly [string, number])[], attributes = 'default-value="0"'): string {
  return `<qti-mapping ${attributes}>${entries.map(([key, value]) => `<qti-map-entry map-key="${key}" mapped-value="${value}"/>`).join("")}</qti-mapping>`;
}

function simpleChoices(count: number, extra: (index: number) => string = () => ""): string {
  return Array.from(
    { length: count },
    (_, index) => `<qti-simple-choice identifier="C${index}"${extra(index)}>c${index}</qti-simple-choice>`,
  ).join("");
}

function choice(attributes: string, count: number, extra?: (index: number) => string): string {
  return `<qti-item-body><qti-choice-interaction response-identifier="RESPONSE" ${attributes}>${simpleChoices(count, extra)}</qti-choice-interaction></qti-item-body>`;
}

function textEntry(before = "<p>x ", after = " y</p>"): string {
  return `<qti-item-body>${before}<qti-text-entry-interaction response-identifier="RESPONSE"/>${after}</qti-item-body>`;
}

function condition(test: string, score: number): string {
  return `<qti-response-processing><qti-response-condition><qti-response-if>${test}<qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">${score}</qti-base-value></qti-set-outcome-value></qti-response-if></qti-response-condition></qti-response-processing>`;
}

function match(sources: number, targets: number, targetMax = "1", markup = -1): string {
  const set = (prefix: string, count: number, max: string) =>
    `<qti-simple-match-set>${Array.from({ length: count }, (_, index) => `<qti-simple-associable-choice identifier="${prefix}${index}" match-max="${max}">${index === markup && prefix === "T" ? `<b>${prefix}${index}</b>` : `${prefix}${index}`}</qti-simple-associable-choice>`).join("")}</qti-simple-match-set>`;
  return `<qti-item-body><qti-match-interaction response-identifier="RESPONSE" max-associations="${sources}">${set("S", sources, "1")}${set("T", targets, targetMax)}</qti-match-interaction></qti-item-body>`;
}

/** Items of the rules that a writer meets, each named for the rule. */
export function buildRuleItems(): readonly AssessmentItem[] {
  return [
    ruleItem(
      "fixed-and-limited",
      declare(
        "multiple",
        "identifier",
        mapping(
          [
            ["C0", 0.5],
            ["C1", 0.5],
          ],
          'default-value="0" lower-bound="0" upper-bound="1"',
        ),
      ) +
        SCORE +
        choice('max-choices="2" min-choices="2" shuffle="true"', 4, (index) => (index === 0 ? ' fixed="true"' : "")) +
        MAP,
    ),
    ruleItem(
      "one-choice",
      declare("single", "identifier", correct("C0")) + SCORE + choice('max-choices="1"', 1) + CORRECT,
    ),
    ruleItem("no-credit", declare("single", "identifier") + SCORE + choice('max-choices="1"', 3)),
    ruleItem(
      "twelve-choices",
      declare(
        "multiple",
        "identifier",
        mapping(
          [...[...Array(11).keys()].map((index): readonly [string, number] => [`C${index}`, 0.1]), ["C11", -1]],
          'default-value="0" lower-bound="0" upper-bound="1"',
        ),
      ) +
        SCORE +
        choice('max-choices="0"', 12) +
        MAP,
    ),
    ruleItem(
      "labels-of-markup",
      declare("single", "identifier", correct("true")) +
        SCORE +
        `<qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1"><qti-simple-choice identifier="true"><b>Yes</b></qti-simple-choice><qti-simple-choice identifier="false">No</qti-simple-choice></qti-choice-interaction></qti-item-body>` +
        CORRECT,
    ),
    ruleItem(
      "match-all-or-nothing",
      declare("multiple", "directedPair", correct("S0 T0", "S1 T1")) + SCORE + match(3, 3, "1", 2) + CORRECT,
    ),
    ruleItem(
      "match-two-right",
      declare(
        "multiple",
        "directedPair",
        mapping([
          ["S0 T0", 1],
          ["S0 T1", 0.5],
          ["S1 T1", 1],
        ]),
      ) +
        SCORE +
        match(2, 2) +
        MAP,
    ),
    ruleItem("match-empty", declare("multiple", "directedPair") + SCORE + match(0, 2) + MAP),
    ruleItem(
      "numbers",
      declare("single", "float", mapping([["7", 1]])) +
        SCORE +
        textEntry() +
        `<qti-response-processing><qti-response-condition><qti-response-if><qti-equal tolerance-mode="relative" tolerance="10"><qti-base-value base-type="float">100</qti-base-value><qti-variable identifier="RESPONSE"/></qti-equal><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value></qti-response-if><qti-response-else-if><qti-equal tolerance-mode="absolute" tolerance="1 3"><qti-base-value base-type="float">50</qti-base-value><qti-variable identifier="RESPONSE"/></qti-equal><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">0.5</qti-base-value></qti-set-outcome-value></qti-response-else-if><qti-response-else-if><qti-equal-rounded rounding-mode="decimalPlaces" figures="1"><qti-base-value base-type="float">3.14</qti-base-value><qti-variable identifier="RESPONSE"/></qti-equal-rounded><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">0.5</qti-base-value></qti-set-outcome-value></qti-response-else-if></qti-response-condition></qti-response-processing>`,
    ),
    ruleItem(
      "integer-tolerance",
      declare("single", "integer") +
        SCORE +
        textEntry() +
        condition(
          '<qti-equal tolerance-mode="absolute" tolerance="2"><qti-base-value base-type="integer">10</qti-base-value><qti-variable identifier="RESPONSE"/></qti-equal>',
          1,
        ),
    ),
    ruleItem("number-no-credit", declare("single", "float", correct("5")) + SCORE + textEntry()),
    ruleItem(
      "text-rules",
      declare("single", "string") +
        SCORE +
        textEntry() +
        `<qti-response-processing><qti-response-condition><qti-response-if><qti-pattern-match pattern="[0-9]+"><qti-variable identifier="RESPONSE"/></qti-pattern-match><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value></qti-response-if><qti-response-else-if><qti-string-match case-sensitive="true"><qti-base-value base-type="string">Alpha</qti-base-value><qti-variable identifier="RESPONSE"/></qti-string-match><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value></qti-response-else-if><qti-response-else-if><qti-string-match case-sensitive="false"><qti-base-value base-type="string">Beta</qti-base-value><qti-variable identifier="RESPONSE"/></qti-string-match><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">0.5</qti-base-value></qti-set-outcome-value></qti-response-else-if></qti-response-condition></qti-response-processing>`,
    ),
    ruleItem("text-format-name", declare("single", "string", correct("[html]x")) + SCORE + textEntry() + CORRECT),
    ruleItem("text-no-credit", declare("single", "string", correct("x")) + SCORE + textEntry()),
    ruleItem(
      "essay-scored",
      declare("single", "string", `<qti-default-value><qti-value>Start</qti-value></qti-default-value>`) +
        SCORE +
        `<qti-item-body><qti-extended-text-interaction response-identifier="RESPONSE" format="preformatted" max-strings="2" expected-length="200"/></qti-item-body>` +
        condition('<qti-not><qti-is-null><qti-variable identifier="RESPONSE"/></qti-is-null></qti-not>', 1),
    ),
    ruleItem("uri-entry", declare("single", "uri") + SCORE + textEntry()),
    ruleItem("undeclared", SCORE + textEntry()),
    ruleItem(
      "description-feedback",
      `<qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier"/><qti-item-body><p>Read.</p></qti-item-body><qti-modal-feedback outcome-identifier="FEEDBACK" show-hide="show" identifier="x"><qti-content-body>F</qti-content-body></qti-modal-feedback>`,
    ),
    ruleItem(
      "content-after",
      declare("single", "identifier", correct("C0")) +
        SCORE +
        `<qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1">${simpleChoices(2)}</qti-choice-interaction><p xml:lang="id">After <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mspace/></math> <qti-printed-variable identifier="SCORE"/></p><qti-rubric-block view="candidate" use="instructions"><qti-content-body><p>Read me.</p></qti-content-body></qti-rubric-block></qti-item-body>` +
        CORRECT,
    ),
    compiledNumber("operator-number", "string"),
    compiledNumber("operator-float", "float"),
  ];
}

/** A number that `number-equivalent` scores, which also takes fractions, of a response of the given base type. */
function compiledNumber(identifier: string, baseType: "string" | "float"): AssessmentItem {
  const scoring = compileScoring([
    { identifier: "RESPONSE", key: { kind: "number", value: 0.5, tolerance: { absolute: 0.01 }, fractions: true } },
  ]);
  const item = ruleItem(identifier, textEntry());
  return {
    ...item,
    responseDeclarations: scoring.responseDeclarations.map((declaration) => ({ ...declaration, baseType })),
    outcomeDeclarations: scoring.outcomeDeclarations,
    responseProcessing: scoring.responseProcessing,
  };
}
