import { readAsi } from "../src/asi/index.js";
import {
  type BankItem,
  readGift,
  readMoodleXml,
  type WriteItemsOptions,
  type WriteMoodleXmlOptions,
  writeGift,
  writeMoodleXml,
} from "../src/item-formats/index.js";
import { createScoringOperators } from "../src/operators/index.js";
import { compileScoring } from "../src/scoring/index.js";
import { decodeBase64 } from "../src/values/index.js";

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

/** A PNG of one transparent pixel, in base64. */
const DOT = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** The options of the Moodle XML writer for the cases: the operators, and the image that an item shows. */
export const XML_WRITE_OPTIONS: WriteMoodleXmlOptions = {
  ...WRITE_OPTIONS,
  files: new Map([["images/dot.png", decodeBase64(DOT) ?? new Uint8Array()]]),
};

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
    item(
      "image-choice",
      "Image choice",
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>B</qti-value></qti-correct-response></qti-response-declaration>${SCORE}<qti-item-body><p>Which shape is this? <img src="images/dot.png" alt="A dot"/></p><qti-choice-interaction response-identifier="RESPONSE" max-choices="1">${choices(["A", "B"], ["A square", "A dot"])}</qti-choice-interaction></qti-item-body><qti-response-processing template="${TEMPLATES}/match_correct.xml"/>`,
    ),
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
  ["Image choice", [{ choice: 0 }, { choice: 1 }]],
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

/** A question of Moodle XML named and worded as given, of two answers, the first right. */
function xmlChoice(name: string, text: string): string {
  return `<question type="multichoice"><name><text>${name}</text></name><questiontext format="html"><text>${text}</text></questiontext><answer fraction="100"><text>a</text></answer><answer fraction="0"><text>b</text></answer></question>`;
}

/**
 * Questions of Moodle XML that its importer may refuse, each between two questions that it reads, to show whether it stops
 * the whole file: values that PHP cannot divide, a question without a name or with one answer, a file that is not base64, and
 * a response format of an essay that Moodle has no renderer of.
 */
const XML_STOPS: readonly (readonly [string, string, string, readonly CaseResponse[]])[] = [
  [
    "xml-fraction-error",
    "Bad fraction",
    '<question type="multichoice"><name><text>Bad fraction</text></name><questiontext><text>q</text></questiontext><answer fraction="abc"><text>a</text></answer><answer fraction="0"><text>b</text></answer></question>',
    [],
  ],
  [
    "xml-number-error",
    "Bad number",
    '<question type="numerical"><name><text>Bad number</text></name><questiontext><text>q</text></questiontext><answer fraction="100"><text>five</text><tolerance>0</tolerance></answer></question>',
    [],
  ],
  [
    "xml-tolerance-error",
    "Bad tolerance",
    '<question type="numerical"><name><text>Bad tolerance</text></name><questiontext><text>q</text></questiontext><answer fraction="100"><text>5</text><tolerance>wide</tolerance></answer></question>',
    [{ text: "5" }, { text: "5.5" }],
  ],
  [
    "xml-mark-error",
    "Bad mark",
    '<question type="shortanswer"><name><text>Bad mark</text></name><questiontext><text>q</text></questiontext><defaultgrade>lots</defaultgrade><answer fraction="100"><text>a</text></answer></question>',
    [],
  ],
  [
    "xml-no-name",
    "",
    '<question type="shortanswer"><questiontext><text>q</text></questiontext><answer fraction="100"><text>a</text></answer></question>',
    [{ text: "a" }, { text: "b" }],
  ],
  [
    "xml-one-answer",
    "One answer",
    '<question type="multichoice"><name><text>One answer</text></name><questiontext><text>q</text></questiontext><answer fraction="100"><text>a</text></answer></question>',
    [],
  ],
  [
    "xml-bad-file",
    "Bad file",
    `<question type="multichoice"><name><text>Bad file</text></name><questiontext format="html"><text><![CDATA[<img src="@@PLUGINFILE@@/x.png" alt="x">]]></text><file name="x.png" path="/" encoding="base64">@@@=${btoa("ABC")}</file></questiontext><answer fraction="100"><text>a</text></answer><answer fraction="0"><text>b</text></answer></question>`,
    [{ choice: 0 }, { choice: 1 }],
  ],
  [
    "xml-essay-format",
    "Canvas essay",
    '<question type="essay"><name><text>Canvas essay</text></name><questiontext><text>q</text></questiontext><responseformat>canvas</responseformat></question>',
    [],
  ],
];

/** GIFT questions of HTML that QTI holds in part: markup to unwrap, code, styles, MathML, tables, lists and identifiers. */
export const HTML_EDGES = {
  markup:
    '::Html::[html]<p style="color:red" class="lead">A <font>red</font> <b>word</b><script>alert(1)</script></p><img src="a.png">{=x ~y}',
  structure:
    '::Html::[html]<math><mi>x</mi><mtext><span>no</span></mtext></math><table><tbody></tbody></table><ul></ul><dl><dt>t</dt></dl><figure><figcaption>c</figcaption><img src="a.png"></figure><p id="a" data-x="1">one</p><p id="a">two</p><svg><circle/></svg><table><tr><td colspan="x">cell</td></tr></table>{=a ~b}',
} as const;

/** Two responses of a choice of two: the first answer, then the second. */
const BOTH: readonly CaseResponse[] = [{ choice: 0 }, { choice: 1 }];

/** The name that Moodle gives a long text without a name: its start, cut at a space, or anywhere when it has none. */
const LONG_TEXT =
  "A very long question text that goes on beyond the default name length of Moodle, which cuts it at a space";
const LONG_WORD = `A${"very".repeat(12)}${["long", "word", "without", "any", "space", "at", "all"].join("")}${"x".repeat(12)}`;

/**
 * Files that Moodle reads past an oddity of: questions without names, a byte order mark, lines ended by carriage returns
 * alone, text formats that Moodle no longer has or never had, an empty numbering, a description's general feedback, and a
 * match of one pair.
 */
const ODD_FILES: readonly MoodleCase[] = [
  {
    name: "gift-names",
    format: "gift",
    file: `\uFEFF{=a ~b}\n\n${LONG_TEXT}{=a ~b}\n\n${LONG_WORD}{=a ~b}\n\nFirst line\n<b>second</b> line{=a ~b}\n`,
    responses: Object.fromEntries([
      ["Question name", BOTH],
      [`${LONG_TEXT.slice(0, 73)}...`, BOTH],
      [`${LONG_WORD.slice(0, 77)}...`, BOTH],
      ["First line\nsecond line", BOTH],
    ]),
  },
  {
    name: "gift-returns",
    format: "gift",
    file: "::A::q{=a ~b}\r\r::B::r{=c ~d}\r",
    responses: Object.fromEntries([
      ["A", BOTH],
      ["B", BOTH],
    ]),
  },
  {
    name: "xml-formats",
    format: "xml",
    file: `<quiz>${[
      '<question type="multichoice"><name><text>Wiki</text></name><questiontext format="wiki_like"><text>a *b*</text></questiontext><answernumbering></answernumbering><answer fraction="100"><text>a</text></answer><answer fraction="0"><text>b</text></answer></question>',
      '<question type="multichoice"><name><text>Rich text</text></name><questiontext format="rtf"><text>a &lt;b&gt;bold&lt;/b&gt;</text></questiontext><answer fraction="100"><text>a</text></answer><answer fraction="0"><text>b</text></answer></question>',
      '<question type="description"><name><text>Description</text></name><questiontext><text>Read.</text></questiontext><generalfeedback><text>General</text></generalfeedback></question>',
    ].join("")}</quiz>\n`,
    responses: Object.fromEntries([
      ["Wiki", BOTH],
      ["Rich text", BOTH],
    ]),
  },
  {
    name: "xml-one-pair",
    format: "xml",
    file: '<quiz><question type="matching"><name><text>One pair</text></name><questiontext><text>m</text></questiontext><subquestion><text>s</text><answer><text>t</text></answer></subquestion></question></quiz>\n',
    responses: Object.fromEntries([["One pair", [{ pairs: [[0, "t"]] }, { pairs: [] }]]]),
  },
];

/** Edge cases of Moodle XML: CDATA, formats, case, marks, combined feedback, hints, units, old files, files, other types. */
export const XML_EDGES = `<?xml version="1.0" encoding="UTF-8"?>
<quiz>
  <question type="category"><category><text>$course$/top/Edges</text></category></question>
  <question type="multichoice">
    <name><text>Several with feedback</text></name>
    <questiontext format="html"><text><![CDATA[<p>Pick the <b>even</b> numbers.</p>]]></text></questiontext>
    <generalfeedback format="html"><text>Even numbers divide by two.</text></generalfeedback>
    <defaultgrade>2</defaultgrade>
    <single>false</single>
    <shuffleanswers>0</shuffleanswers>
    <correctfeedback format="html"><text>All right.</text></correctfeedback>
    <partiallycorrectfeedback format="html"><text>Partly.</text></partiallycorrectfeedback>
    <incorrectfeedback format="html"><text>Wrong.</text></incorrectfeedback>
    <answer fraction="50" format="html"><text>2</text><feedback format="html"><text>Yes, 2.</text></feedback></answer>
    <answer fraction="50" format="html"><text>4</text></answer>
    <answer fraction="-100" format="html"><text>5</text><feedback format="html"><text>No.</text></feedback></answer>
    <hint format="html"><text>Think of two.</text></hint>
  </question>
  <question type="multichoice">
    <name><text>Single with a mark</text></name>
    <questiontext format="html"><text>Which tag is bold?</text></questiontext>
    <defaultgrade>3</defaultgrade>
    <answer fraction="100" format="html"><text>&lt;code&gt;&amp;lt;b&amp;gt;&lt;/code&gt;</text></answer>
    <answer fraction="0" format="html"><text>&lt;code&gt;&amp;lt;i&amp;gt;&lt;/code&gt;</text></answer>
  </question>
  <question type="shortanswer">
    <name><text>Case counts</text></name>
    <questiontext format="moodle_auto_format"><text>The symbol of sodium is _____ in the table.</text></questiontext>
    <usecase>1</usecase>
    <answer fraction="100"><text>Na</text><feedback><text>Right.</text></feedback></answer>
    <answer fraction="0"><text>*</text><feedback><text>Look again.</text></feedback></answer>
  </question>
  <question type="numerical">
    <name><text>Units and any other</text></name>
    <questiontext format="plain_text"><text>Distance in km?
On two lines.</text></questiontext>
    <answer fraction="100"><text>12.5</text><tolerance>0.5</tolerance><feedback><text>Close.</text></feedback></answer>
    <answer fraction="50"><text>12.5</text><tolerance>2</tolerance></answer>
    <answer fraction="0"><text>*</text><feedback><text>Far.</text></feedback></answer>
    <units><unit><multiplier>1</multiplier><unit_name>km</unit_name></unit></units>
  </question>
  <question type="numerical">
    <name><text>Old fraction</text></name>
    <questiontext format="html"><text>Three?</text></questiontext>
    <answer><text>3</text><fraction>1</fraction><tolerance>0</tolerance></answer>
  </question>
  <question type="truefalse">
    <name><text>Old true or false</text></name>
    <questiontext format="html"><text>Water is wet.</text></questiontext>
    <answer fraction="100"><text>Yes</text><feedback><text>Indeed.</text></feedback></answer>
    <answer fraction="0"><text>No</text></answer>
  </question>
  <question type="matching">
    <name><text>Match with an extra</text></name>
    <questiontext format="html"><text>Match the words with the numbers.</text></questiontext>
    <shuffleanswers>false</shuffleanswers>
    <subquestion format="html"><text>One</text><answer><text>1</text></answer></subquestion>
    <subquestion format="html"><text>Two</text><answer><text>2</text></answer></subquestion>
    <subquestion format="html"><text></text><answer><text>3</text></answer></subquestion>
  </question>
  <question type="essay">
    <name><text>Essay with options</text></name>
    <questiontext format="markdown"><text>Write **two** paragraphs.</text></questiontext>
    <responseformat>plain</responseformat>
    <responserequired>0</responserequired>
    <responsefieldlines>5</responsefieldlines>
    <minwordlimit>50</minwordlimit>
    <maxwordlimit>200</maxwordlimit>
    <attachments>1</attachments>
    <graderinfo format="html"><text>Look for two ideas.</text></graderinfo>
    <responsetemplate format="html"><text>Begin here.</text></responsetemplate>
  </question>
  <question type="description">
    <name><text>Picture</text></name>
    <questiontext format="html"><text><![CDATA[<p><img src="@@PLUGINFILE@@/dot%20one.png" alt="A dot"></p>]]></text><file name="dot one.png" path="/" encoding="base64">${DOT}</file></questiontext>
  </question>
  <question type="cloze">
    <name><text>Cloze</text></name>
    <questiontext format="html"><text>Two and two make {1:SHORTANSWER:=four}.</text></questiontext>
  </question>
</quiz>
`;

const XML_EDGE_RESPONSES: readonly (readonly [string, readonly CaseResponse[]])[] = [
  ["Several with feedback", [{ choices: [0] }, { choices: [0, 1] }, { choices: [0, 2] }, { choices: [2] }]],
  ["Single with a mark", [{ choice: 0 }, { choice: 1 }]],
  ["Case counts", [{ text: "Na" }, { text: "na" }, { text: "NA" }, { text: "K" }]],
  ["Units and any other", [{ text: "12.5" }, { text: "13" }, { text: "14" }, { text: "15" }, { text: "9" }]],
  ["Old fraction", [{ text: "3" }, { text: "4" }]],
  ["Old true or false", [{ value: true }, { value: false }]],
  [
    "Match with an extra",
    [
      {
        pairs: [
          [0, "1"],
          [1, "2"],
        ],
      },
      {
        pairs: [
          [0, "3"],
          [1, "2"],
        ],
      },
    ],
  ],
];

/** The edge cases of Moodle XML, read and written back with their files. */
function rewrittenXml(): string {
  const { items, files } = readMoodleXml(XML_EDGES);
  return writeMoodleXml(items, { files }).text;
}

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
      {
        name: "xml-written",
        format: "xml",
        file: writeMoodleXml(buildWrittenItems(), XML_WRITE_OPTIONS).text,
        responses: Object.fromEntries(WRITTEN_RESPONSES),
      },
      { name: "xml-edges", format: "xml", file: XML_EDGES, responses: Object.fromEntries(XML_EDGE_RESPONSES) },
      {
        name: "xml-rewritten",
        format: "xml",
        file: rewrittenXml(),
        responses: Object.fromEntries(XML_EDGE_RESPONSES),
      },
      ...GIFT_STOPS.map(([name, file]) => ({
        name,
        format: "gift" as const,
        file,
        responses: Object.fromEntries([["Fine", [{ choice: 0 }]]]),
      })),
      ...ODD_FILES,
      ...XML_STOPS.map(([name, title, question, responses]) => ({
        name,
        format: "xml" as const,
        file: `<quiz>${xmlChoice("Fine", "A question before.")}${question}${xmlChoice("After", "A question after.")}</quiz>\n`,
        responses: Object.fromEntries([
          ["Fine", [{ choice: 0 }]],
          [title, responses],
          ["After", [{ choice: 0 }]],
        ]),
      })),
    ],
  };
}
