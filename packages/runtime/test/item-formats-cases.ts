import { readAsi } from "../src/asi/index.js";
import { type BankItem, readGift, type WriteItemsOptions, writeGift } from "../src/item-formats/index.js";
import { createScoringOperators } from "../src/operators/index.js";
import { compileScoring } from "../src/scoring/index.js";

// The cases that validation/moodle.py gives Moodle: items that writeGift writes, and edge cases of GIFT typed as Moodle's
// documentation of the format describes them. The fixture holds them with Moodle's readings, and item-formats.test.ts checks
// that the writer still writes the same files.

/**
 * A response of a case, by the position of the answers in the file: no response, a choice, several choices, true or false,
 * a text, or pairs of a stem's position and an answer's text.
 */
export type CaseResponse =
  | null
  | { readonly choice: number }
  | { readonly choices: readonly number[] }
  | { readonly value: boolean }
  | { readonly text: string }
  | { readonly pairs: readonly (readonly [number, string])[] };

/** A file for Moodle to import, with the responses to grade for each question, by its name. */
export interface MoodleCase {
  readonly name: string;
  readonly format: "gift" | "xml";
  readonly file: string;
  readonly responses: Readonly<Record<string, readonly CaseResponse[]>>;
}

/** The options of the writers for the cases: the scoring operators, which the items that `compileScoring` writes call. */
export const WRITE_OPTIONS: WriteItemsOptions = { customOperators: createScoringOperators() };

const NS = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';
const TEMPLATES = "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates";

const SCORE = `<qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>`;
const FEEDBACK = `<qti-outcome-declaration identifier="FEEDBACK" cardinality="multiple" base-type="identifier"/>`;

function item(identifier: string, title: string, inner: string): string {
  return `<qti-assessment-item ${NS} identifier="${identifier}" title="${title}" adaptive="false" time-dependent="false">${inner}</qti-assessment-item>`;
}

function choices(ids: readonly string[], texts: readonly string[] = ids): string {
  return ids.map((id, index) => `<qti-simple-choice identifier="${id}">${texts[index]}</qti-simple-choice>`).join("");
}

function modal(identifier: string, text: string, showHide = "show"): string {
  return `<qti-modal-feedback outcome-identifier="FEEDBACK" show-hide="${showHide}" identifier="${identifier}"><qti-content-body><p>${text}</p></qti-content-body></qti-modal-feedback>`;
}

/** Items of each interaction that converts, with their scoring and feedback, as an author or `compileScoring` writes them. */
export function buildWrittenItems(): readonly BankItem[] {
  const xml = [
    item(
      "choice-partial",
      "Choice with partial credit",
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>A</qti-value></qti-correct-response><qti-mapping default-value="0"><qti-map-entry map-key="A" mapped-value="2"/><qti-map-entry map-key="B" mapped-value="1"/><qti-map-entry map-key="D" mapped-value="-0.5"/></qti-mapping></qti-response-declaration>${SCORE}<qti-outcome-declaration identifier="MAXSCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>2</qti-value></qti-default-value></qti-outcome-declaration>${FEEDBACK}<qti-item-body><p>Which number is prime?</p><qti-choice-interaction response-identifier="RESPONSE" max-choices="1" shuffle="true">${choices(["A", "B", "C", "D"], ["7", "9", "8", "1"])}</qti-choice-interaction></qti-item-body><qti-response-processing><qti-response-condition><qti-response-if><qti-is-null><qti-variable identifier="RESPONSE"/></qti-is-null><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">0</qti-base-value></qti-set-outcome-value></qti-response-if><qti-response-else><qti-set-outcome-value identifier="SCORE"><qti-map-response identifier="RESPONSE"/></qti-set-outcome-value></qti-response-else></qti-response-condition><qti-set-outcome-value identifier="FEEDBACK"><qti-multiple><qti-variable identifier="RESPONSE"/></qti-multiple></qti-set-outcome-value></qti-response-processing>${modal("A", "Seven has no divisor but 1 and itself.")}${modal("D", "One is not prime.")}${modal("never", "Primes have exactly two divisors.", "hide")}`,
    ),
    item(
      "choice-multiple",
      "Choice of several answers",
      `<qti-response-declaration identifier="RESPONSE" cardinality="multiple" base-type="identifier"><qti-correct-response><qti-value>A</qti-value><qti-value>B</qti-value></qti-correct-response><qti-mapping lower-bound="0" upper-bound="1" default-value="0"><qti-map-entry map-key="A" mapped-value="0.5"/><qti-map-entry map-key="B" mapped-value="0.5"/><qti-map-entry map-key="C" mapped-value="-1"/></qti-mapping></qti-response-declaration>${SCORE}<qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="0"><qti-prompt>Which are even?</qti-prompt>${choices(["A", "B", "C", "D"], ["2", "4", "5", "7"])}</qti-choice-interaction></qti-item-body><qti-response-processing template="${TEMPLATES}/map_response.xml"/>`,
    ),
    item(
      "choice-all-or-nothing",
      "All or nothing",
      `<qti-response-declaration identifier="RESPONSE" cardinality="multiple" base-type="identifier"><qti-correct-response><qti-value>A</qti-value><qti-value>C</qti-value></qti-correct-response></qti-response-declaration>${SCORE}<qti-item-body><p>Which are colors?</p><qti-choice-interaction response-identifier="RESPONSE" max-choices="0">${choices(["A", "B", "C"], ["Red", "Table", "Blue"])}</qti-choice-interaction></qti-item-body><qti-response-processing template="${TEMPLATES}/match_correct.xml"/>`,
    ),
    item(
      "true-false",
      "True or false",
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>false</qti-value></qti-correct-response></qti-response-declaration>${SCORE}<qti-item-body><p>The Moon is a planet.</p><qti-choice-interaction response-identifier="RESPONSE" max-choices="1">${choices(["true", "false"], ["True", "False"])}</qti-choice-interaction></qti-item-body><qti-response-processing template="${TEMPLATES}/match_correct.xml"/>`,
    ),
    item(
      "inline-choice",
      "Inline choice",
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>Y</qti-value></qti-correct-response></qti-response-declaration>${SCORE}<qti-item-body><p>Water boils at <qti-inline-choice-interaction response-identifier="RESPONSE"><qti-inline-choice identifier="X">90</qti-inline-choice><qti-inline-choice identifier="Y">100</qti-inline-choice><qti-inline-choice identifier="Z">110</qti-inline-choice></qti-inline-choice-interaction> degrees at sea level.</p></qti-item-body><qti-response-processing template="${TEMPLATES}/match_correct.xml"/>`,
    ),
    item(
      "text-mapping",
      "Text with a mapping",
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"><qti-correct-response><qti-value>Jakarta</qti-value></qti-correct-response><qti-mapping default-value="0"><qti-map-entry map-key="Jakarta" mapped-value="1" case-sensitive="false"/><qti-map-entry map-key="Batavia" mapped-value="0.5" case-sensitive="false"/></qti-mapping></qti-response-declaration>${SCORE}<qti-item-body><p>The capital of Indonesia is <qti-text-entry-interaction response-identifier="RESPONSE"/> today.</p></qti-item-body><qti-response-processing template="${TEMPLATES}/map_response.xml"/>`,
    ),
    item(
      "number-exact",
      "Exact number",
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="integer"><qti-correct-response><qti-value>42</qti-value></qti-correct-response></qti-response-declaration>${SCORE}<qti-item-body><p>Six times seven is <qti-text-entry-interaction response-identifier="RESPONSE"/></p></qti-item-body><qti-response-processing template="${TEMPLATES}/match_correct.xml"/>`,
    ),
    item(
      "escapes",
      "Marks {=~#:\\} and markup",
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>A</qti-value></qti-correct-response></qti-response-declaration>${SCORE}<qti-item-body><p>Let <em>x</em> = {1, 2}: is ~x #1? Path C:\\temp</p><qti-choice-interaction response-identifier="RESPONSE" max-choices="1">${choices(["A", "B", "C"], ["<strong>a = b</strong>", "c ~ d -&gt; e", "{f} #g"])}</qti-choice-interaction></qti-item-body><qti-response-processing template="${TEMPLATES}/match_correct.xml"/>`,
    ),
    item(
      "essay",
      "Essay",
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/><qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human" normal-maximum="5"/><qti-item-body><p>Describe the water cycle.</p><qti-extended-text-interaction response-identifier="RESPONSE" format="xhtml" expected-lines="10"/><qti-rubric-block view="scorer" use="scoring"><qti-content-body><p>Evaporation, condensation, precipitation.</p></qti-content-body></qti-rubric-block></qti-item-body>`,
    ),
    item("description", "Description", `<qti-item-body><p>Read the next questions with care.</p></qti-item-body>`),
  ];
  const parsed = xml.map((text) => {
    const document = readAsi(text);
    if (document.kind !== "item") throw new Error("Each case is an item.");
    return document.item;
  });
  const compiled = [
    compiledItem(
      "text-operator",
      "Text by the operator",
      '<p>The capital of France is <qti-text-entry-interaction response-identifier="RESPONSE"/>.</p>',
      {
        identifier: "RESPONSE",
        key: { kind: "text", answers: [{ texts: ["Paris"] }] },
      },
    ),
    compiledItem(
      "number-tolerance",
      "Number with a tolerance",
      '<p>Gravity in m/s²: <qti-text-entry-interaction response-identifier="RESPONSE"/> near the ground.</p>',
      {
        identifier: "RESPONSE",
        key: { kind: "number", value: 9.81, tolerance: { absolute: 0.05 } },
      },
    ),
    compiledItem(
      "match-pairs",
      "Matching pairs",
      `<p>Match each country with its capital.</p><qti-match-interaction response-identifier="RESPONSE" max-associations="3"><qti-simple-match-set><qti-simple-associable-choice identifier="ID" match-max="1">Indonesia</qti-simple-associable-choice><qti-simple-associable-choice identifier="JP" match-max="1">Japan</qti-simple-associable-choice><qti-simple-associable-choice identifier="FR" match-max="1">France</qti-simple-associable-choice></qti-simple-match-set><qti-simple-match-set><qti-simple-associable-choice identifier="JKT" match-max="0">Jakarta</qti-simple-associable-choice><qti-simple-associable-choice identifier="TYO" match-max="0">Tokyo</qti-simple-associable-choice><qti-simple-associable-choice identifier="PAR" match-max="0">Paris</qti-simple-associable-choice><qti-simple-associable-choice identifier="ROM" match-max="0">Rome</qti-simple-associable-choice></qti-simple-match-set></qti-match-interaction>`,
      {
        identifier: "RESPONSE",
        key: {
          kind: "pairs",
          pairs: [
            ["ID", "JKT"],
            ["JP", "TYO"],
            ["FR", "PAR"],
          ],
          scheme: "per-pair",
        },
      },
    ),
  ];
  return [...parsed, ...compiled].map((parsedItem) => ({
    item: parsedItem,
    category: "$course$/top/Written",
    tags: ["written"],
  }));
}

function compiledItem(
  identifier: string,
  title: string,
  body: string,
  response: Parameters<typeof compileScoring>[0][number],
) {
  const scoring = compileScoring([response]);
  const document = readAsi(item(identifier, title, `<qti-item-body>${body}</qti-item-body>`));
  if (document.kind !== "item") throw new Error("Each case is an item.");
  const { responseDeclarations, outcomeDeclarations, responseProcessing } = scoring;
  return { ...document.item, responseDeclarations, outcomeDeclarations, responseProcessing };
}

/** The responses of the written items, by the title that names their question. */
const WRITTEN_RESPONSES: readonly (readonly [string, readonly CaseResponse[]])[] = [
  ["Choice with partial credit", [null, { choice: 0 }, { choice: 1 }, { choice: 2 }, { choice: 3 }]],
  [
    "Choice of several answers",
    [{ choices: [0] }, { choices: [0, 1] }, { choices: [0, 2] }, { choices: [0, 1, 2] }, { choices: [3] }, null],
  ],
  ["All or nothing", [{ choices: [0, 2] }, { choices: [0] }, { choices: [0, 1, 2] }, { choices: [1] }]],
  ["True or false", [{ value: true }, { value: false }, null]],
  ["Inline choice", [{ choice: 0 }, { choice: 1 }, { choice: 2 }]],
  ["Text with a mapping", [{ text: "Jakarta" }, { text: "jakarta" }, { text: "Batavia" }, { text: "Bandung" }, null]],
  ["Exact number", [{ text: "42" }, { text: "41" }]],
  ["Marks {=~#:\\} and markup", [{ choice: 0 }, { choice: 1 }, { choice: 2 }]],
  ["Text by the operator", [{ text: "Paris" }, { text: "paris" }, { text: "Lyon" }]],
  ["Number with a tolerance", [{ text: "9.81" }, { text: "9.85" }, { text: "9.9" }, { text: "9" }]],
  [
    "Matching pairs",
    [
      {
        pairs: [
          [0, "Jakarta"],
          [1, "Tokyo"],
          [2, "Paris"],
        ],
      },
      {
        pairs: [
          [0, "Jakarta"],
          [1, "Paris"],
          [2, "Rome"],
        ],
      },
      { pairs: [[0, "Rome"]] },
    ],
  ],
];

/** Edge cases of GIFT: escapes, formats, weights, missing words, numbers, matching, comments, categories and refusals. */
export const GIFT_EDGES = `// A comment that is not a question.
// [id:edge-escapes] [tag:alpha] [tag:be\\]ta]
::Escapes\\: all::Braces \\{1\\}, \\= equals, \\~ tilde, \\# hash, \\\\ backslash and\\na line break.{=right\\#1 ~wrong\\=2}

::Weights::Pick the parts.{~%50%half ~%33.33333%third ~%-50%penalty ~%100%full ~none}

::Missing::The {=cat ~dog ~cow} sat on the mat.

::Missing short::Two plus two is {=four =%50%for} today.

::Number not a number::Any number will do.{#abc}

::Number range::Pick a number from 1 to 5.{#1..5#In range.}

::Number answers::About ten.{#=10:1#Close. =%50%10:3 ~#Far.}

::False::Penguins fly.{FALSE#They do not.#Right.####Penguins swim.}

::Plain::[plain]<b>not bold</b> and 2 < 3 {=yes ~no}

::Markdown::[markdown]**bold** text {=a ~b}

::Html::[html]<p>Para <em>one</em></p><script>alert(1)</script><font color="red">red</font>{=x ~y}

::Pairs::Match the letters.{=a -> 1 =b -> 2 =c -> 3 = -> 4}

::Wildcards::Name a fruit.{=*apple* =%50%ban\\*na}

::Broken::Text {=a ~b

::Bad pair::Match.{=a -> 1 =b}

::Off grid::Credit not in the list.{=%35%a =b}

$CATEGORY: $course$/top/Edge cases

::Essay::Write a paragraph.{####A model answer.}

::Description::Just a description.

::Zero line::First part
0
of question?{=x ~y}
`;

const GIFT_EDGE_RESPONSES: readonly (readonly [string, readonly CaseResponse[]])[] = [
  ["Escapes: all", [{ choice: 0 }, { choice: 1 }]],
  [
    "Weights",
    [
      { choices: [0] },
      { choices: [0, 1] },
      { choices: [0, 2] },
      { choices: [2] },
      { choices: [3, 0] },
      { choices: [4] },
    ],
  ],
  ["Missing", [{ choice: 0 }, { choice: 1 }]],
  ["Missing short", [{ text: "four" }, { text: "FOUR" }, { text: "for" }, { text: " four " }, { text: "five" }]],
  ["Number not a number", [{ text: "1" }, { text: "-3.5" }]],
  ["Number range", [{ text: "1" }, { text: "3" }, { text: "5" }, { text: "5.1" }, { text: "0.9" }]],
  ["Number answers", [{ text: "10" }, { text: "11" }, { text: "12" }, { text: "13" }, { text: "14" }]],
  ["False", [{ value: true }, { value: false }]],
  ["Plain", [{ choice: 0 }, { choice: 1 }]],
  ["Markdown", [{ choice: 0 }, { choice: 1 }]],
  ["Html", [{ choice: 0 }, { choice: 1 }]],
  [
    "Pairs",
    [
      {
        pairs: [
          [0, "1"],
          [1, "2"],
          [2, "3"],
        ],
      },
      {
        pairs: [
          [0, "1"],
          [1, "4"],
        ],
      },
    ],
  ],
  ["Wildcards", [{ text: "pineapple" }, { text: "Apple pie" }, { text: "ban*na" }, { text: "banana" }]],
  ["Off grid", [{ text: "a" }, { text: "b" }]],
  ["of question?", [{ choice: 0 }, { choice: 1 }]],
];

/**
 * Questions that stop Moodle's import of the whole file: a weight that PHP cannot divide, and refusals whose message Moodle
 * 5.3 builds from an array, which `htmlspecialchars` throws on.
 */
const GIFT_STOPS: readonly (readonly [string, string])[] = [
  ["gift-weight-error", "::Fine::A question before.{=a ~b}\n\n::Double minus::Weight.{=a ~%--50%b}\n"],
  ["gift-one-answer", "::Fine::A question before.{=a ~b}\n\n::One answer::Only one.{~only}\n"],
  ["gift-number-error", "::Fine::A question before.{=a ~b}\n\n::Bad tolerance::Number.{#5:x}\n"],
  ["gift-no-number", "::Fine::A question before.{=a ~b}\n\n::No number::Number.{#}\n"],
];

/** The cases that validation/moodle.py gives Moodle, in order. */
export function buildMoodleCases(): { readonly cases: readonly MoodleCase[] } {
  return {
    cases: [
      {
        name: "gift-written",
        format: "gift",
        file: writeGift(buildWrittenItems(), WRITE_OPTIONS).text,
        responses: Object.fromEntries(WRITTEN_RESPONSES),
      },
      { name: "gift-edges", format: "gift", file: GIFT_EDGES, responses: Object.fromEntries(GIFT_EDGE_RESPONSES) },
      {
        name: "gift-rewritten",
        format: "gift",
        file: writeGift(readGift(GIFT_EDGES).items).text,
        responses: Object.fromEntries(GIFT_EDGE_RESPONSES),
      },
      ...GIFT_STOPS.map(([name, file]) => ({
        name,
        format: "gift" as const,
        file,
        responses: Object.fromEntries([["Fine", [{ choice: 0 }]]]),
      })),
    ],
  };
}
