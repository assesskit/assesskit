import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import { type AssessmentItem, readAsi, writeAsi } from "../src/asi/index.js";
import { DataError, ReadError, SecurityError } from "../src/errors.js";
import {
  type ConversionLoss,
  type ImportedItems,
  readGift,
  readMoodleXml,
  writeGift,
  writeMoodleXml,
} from "../src/item-formats/index.js";
import { createScoringOperators } from "../src/operators/index.js";
import { createItemVariables, runResponseProcessing } from "../src/processing/index.js";
import { createRandom } from "../src/random.js";
import { buildContainer, buildSingle, type Value } from "../src/values/index.js";
import { parseXml, type XmlElement, type XmlNode } from "../src/xml/index.js";
import { giftMutations, markedText, weightedChoices } from "./arbitraries/item-formats.js";
import { mutateText } from "./arbitraries/xml.js";
import { readFixture } from "./fixtures.js";
import { expectOutcome, FUZZ, fuzzReader } from "./fuzz.js";
import {
  buildMoodleCases,
  buildWrittenItems,
  type CaseResponse,
  HTML_EDGES,
  type MoodleCase,
  WRITE_OPTIONS,
  XML_EDGES,
  XML_WRITE_OPTIONS,
} from "./item-formats-cases.js";
import { buildRuleItems } from "./item-formats-rules.js";

/** What Moodle stored of a question, as validation/moodle/questions.php records it. */
interface MoodleQuestion {
  readonly read: {
    readonly qtype: string;
    readonly name: string;
    readonly usecase?: number;
    readonly questiontext: { readonly text: string; readonly format: string };
    readonly answers?: readonly { readonly answer: string; readonly fraction: number }[];
    readonly subquestions?: readonly { readonly questiontext: string; readonly answertext: string }[];
  };
  readonly grades: readonly (number | null)[];
  readonly gift: string;
  readonly xml: string;
}

/** `item-formats-moodle.json`, which `validation/moodle.py` writes. */
interface MoodleFixture {
  readonly moodle: { readonly version: string; readonly commit: string };
  readonly cases: readonly (MoodleCase & {
    readonly moodle: {
      readonly failure: string | null;
      readonly log: string;
      readonly questions: readonly MoodleQuestion[];
    };
  })[];
}

const fixture = readFixture<MoodleFixture>("item-formats-moodle.json");
const OPERATORS = createScoringOperators();

function children(element: XmlElement, name?: string): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement => child.kind === "element" && (name === undefined || child.name === name),
  );
}

function descendants(element: XmlElement, test: (element: XmlElement) => boolean): XmlElement[] {
  return children(element).flatMap((child) => [...(test(child) ? [child] : []), ...descendants(child, test)]);
}

function attribute(element: XmlElement, name: string): string | undefined {
  return element.attributes.find((candidate) => candidate.name === name)?.value;
}

function textOf(nodes: readonly XmlNode[]): string {
  return nodes
    .map((node) => (node.kind === "element" ? textOf(node.children) : node.kind === "text" ? node.value : ""))
    .join("");
}

/** The QTI value of a response of a case, for the item's interaction. */
function responseValue(tree: XmlElement, response: CaseResponse): Value | null {
  if (response === null) return null;
  const [interaction] = descendants(tree, ({ name }) => name.endsWith("-interaction"));
  if (interaction === undefined) throw new Error("The item has no interaction.");
  const declaration = children(tree, "qti-response-declaration")[0];
  const baseType = declaration === undefined ? "string" : attribute(declaration, "base-type");
  const single = declaration !== undefined && attribute(declaration, "cardinality") === "single";
  const ids = descendants(interaction, ({ name }) => name === "qti-simple-choice" || name === "qti-inline-choice").map(
    (choice) => attribute(choice, "identifier") ?? "",
  );
  if ("choice" in response) {
    const id = ids[response.choice] ?? "";
    return single ? buildSingle("identifier", id) : buildContainer("multiple", "identifier", [id]);
  }
  if ("choices" in response)
    return buildContainer(
      "multiple",
      "identifier",
      response.choices.map((index) => ids[index] ?? ""),
    );
  if ("value" in response) return buildSingle("identifier", String(response.value));
  if ("text" in response) {
    if (baseType === "string") return buildSingle("string", response.text);
    const number = Number(response.text);
    if (response.text.trim() === "" || !Number.isFinite(number)) return null;
    if (baseType === "integer") return Number.isInteger(number) ? buildSingle("integer", number) : null;
    return buildSingle("float", number);
  }
  const [sources = [], targets = []] = children(interaction, "qti-simple-match-set").map((set) => children(set));
  return buildContainer(
    "multiple",
    "directedPair",
    response.pairs.map(([stem, answer]) => [
      attribute(sources[stem] ?? interaction, "identifier") ?? "",
      attribute(targets.find((target) => textOf(target.children).trim() === answer) ?? interaction, "identifier") ?? "",
    ]),
  );
}

/** The share of its maximum that an item gives a response, by its own response processing on the runtime. */
function scoreOf(item: AssessmentItem, response: CaseResponse): number {
  const tree = parseXml(writeAsi({ kind: "item", item }));
  const [interaction] = descendants(tree, ({ name }) => name.endsWith("-interaction"));
  const variables = createItemVariables(item);
  const responses = new Map(variables.responses).set(
    attribute(interaction ?? tree, "response-identifier") ?? "RESPONSE",
    responseValue(tree, response),
  );
  const { outcomes } = runResponseProcessing(
    item,
    { ...variables, responses },
    { random: createRandom(0), customOperators: OPERATORS },
  );
  const score = outcomes.get("SCORE");
  const max = outcomes.get("MAXSCORE");
  const scoreValue = score?.cardinality === "single" && typeof score.value === "number" ? score.value : 0;
  const maxValue = max?.cardinality === "single" && typeof max.value === "number" && max.value > 0 ? max.value : 1;
  return scoreValue / maxValue;
}

function caseNamed(name: string) {
  const found = fixture.cases.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`The fixture has no case ${name}.`);
  return found;
}

/** Expects an item to score each response of a case as Moodle graded it; Moodle leaves a response it cannot grade at 0. */
function expectMoodleGrades(
  item: AssessmentItem,
  responses: readonly CaseResponse[],
  grades: readonly (number | null)[],
): void {
  expect(grades).toHaveLength(responses.length);
  for (const [index, response] of responses.entries()) {
    expect(scoreOf(item, response), `${item.title}, response ${JSON.stringify(response)}`).toBeCloseTo(
      grades[index] ?? 0,
      9,
    );
  }
}

/** The reader of a case's format; Moodle exports one question of XML without the root of a file. */
function readCase(format: "gift" | "xml", text: string): ImportedItems {
  if (format === "gift") return readGift(text);
  return readMoodleXml(/^\s*<(?:\?xml|quiz)/.test(text) ? text : `<quiz>${text}</quiz>`);
}

describe("readGift and readMoodleXml", () => {
  const read = ["gift-written", "gift-edges", "gift-rewritten", "xml-written", "xml-edges", "xml-rewritten"];
  for (const name of [...read, "gift-names", "gift-returns", "xml-formats", "xml-one-pair"]) {
    it(`reads each question of ${name} as Moodle 5.3 does, and scores each response as Moodle grades it`, () => {
      const testCase = caseNamed(name);
      const { items } = readCase(testCase.format, testCase.file);
      for (const question of testCase.moodle.questions) {
        const read = items.find(({ item }) => item.title === question.read.name);
        // A cloze question holds several answers in its text, which no item of one interaction holds.
        if (question.read.qtype === "multianswer") {
          expect(read).toBeUndefined();
          continue;
        }
        expect(read, question.read.name).toBeDefined();
        if (read === undefined) continue;
        expectMoodleGrades(read.item, testCase.responses[question.read.name] ?? [], question.grades);
      }
    });

    it(`reads the GIFT and the XML that Moodle exports of each question of ${name} as Moodle grades it`, () => {
      const testCase = caseNamed(name);
      for (const question of testCase.moodle.questions) {
        const xml = readCase("xml", question.xml);
        expect(xml.losses.filter(({ omitted }) => omitted).length, question.read.name).toBe(
          question.read.qtype === "multianswer" ? 1 : 0,
        );
        if (xml.items[0] !== undefined) {
          expectMoodleGrades(xml.items[0].item, testCase.responses[question.read.name] ?? [], question.grades);
        }
        // GIFT holds no case, so Moodle's own GIFT of a question that keeps case reads back without it.
        if (question.read.qtype === "multianswer" || question.read.usecase === 1) continue;
        const { items, losses } = readGift(question.gift);
        // Moodle's GIFT of a name of two lines puts its second line in the text of the file, which reads as text again.
        if (question.read.name.includes("\n")) continue;
        // Moodle exports an answer "*" of full credit as "~#", which leaves the question no answer, and a match of one pair:
        // its own importer refuses both.
        if (
          (question.read.qtype === "numerical" && !/^\t=/m.test(question.gift)) ||
          (question.read.qtype === "match" && (question.read.subquestions?.length ?? 0) < 2)
        ) {
          expect(losses.map(({ omitted, reason }) => [omitted, reason])).toStrictEqual([[true, "item"]]);
          continue;
        }
        expect(losses.filter(({ omitted }) => omitted)).toStrictEqual([]);
        const [read] = items;
        expect(read?.item.title).toBe(question.read.name);
        if (read !== undefined)
          expectMoodleGrades(read.item, testCase.responses[question.read.name] ?? [], question.grades);
      }
    });
  }

  it("writes back what it reads of GIFT so that Moodle grades each response alike", () => {
    const edges = caseNamed("gift-edges").moodle.questions;
    const rewritten = caseNamed("gift-rewritten");
    expect(rewritten.moodle.failure).toBeNull();
    const { losses } = writeGift(readGift(caseNamed("gift-edges").file).items);
    const omitted = new Set(losses.filter((loss) => loss.omitted).map(({ item }) => item));
    expect(omitted).toStrictEqual(new Set(["item-5"]));
    for (const question of edges) {
      const again = rewritten.moodle.questions.find(({ read }) => read.name === question.read.name);
      if (question.read.name === "Number not a number") expect(again).toBeUndefined();
      else expect(again?.grades, question.read.name).toStrictEqual(question.grades);
    }
  });

  it("writes back what it reads of Moodle XML, with its files, so that Moodle grades each response alike", () => {
    const edges = caseNamed("xml-edges").moodle.questions;
    const rewritten = caseNamed("xml-rewritten");
    expect(rewritten.moodle.failure).toBeNull();
    for (const question of edges.filter(({ read }) => read.qtype !== "multianswer")) {
      const again = rewritten.moodle.questions.find(({ read }) => read.name === question.read.name);
      expect(again?.grades, question.read.name).toStrictEqual(question.grades);
    }
    expect(rewritten.moodle.questions.map(({ read }) => read.name)).not.toContain("Cloze");
  });

  it("reads the files that a text embeds, under the item, and writes them back where a text names them", () => {
    const { items, files } = readMoodleXml(XML_EDGES);
    expect([...files.keys()]).toStrictEqual(["files/item-9/dot%20one.png"]);
    const picture = items.find(({ item }) => item.title === "Picture")?.item;
    expect(picture === undefined ? "" : writeAsi({ kind: "item", item: picture })).toContain(
      '<img src="files/item-9/dot%20one.png" alt="A dot"/>',
    );
    const { text, losses } = writeMoodleXml(items, { files });
    expect(text).toContain('src="@@PLUGINFILE@@/files/item-9/dot%20one.png"');
    expect(text).toContain('<file name="dot one.png" path="/files/item-9/" encoding="base64">');
    expect(losses.filter(({ reason }) => reason === "content" && /files/.test(reason))).toStrictEqual([]);
    const remote = readGift('[html]<img src="https://example.org/a.png" alt="a">{=a ~b}').items;
    expect(writeMoodleXml(remote, { files }).text).toContain('src="https://example.org/a.png"');
    const missing = writeMoodleXml(items).losses.filter(({ message }) => message.startsWith("The files"));
    expect(missing.map(({ item, reason }) => [item, reason])).toStrictEqual([["item-9", "content"]]);
    expect(
      writeGift(items)
        .losses.filter(({ message }) => message.startsWith("GIFT holds no files"))
        .map(({ item }) => item),
    ).toStrictEqual(["item-9"]);
  });

  it("leaves out the questions of a type that does not convert, and keeps Moodle XML's settings and feedback", () => {
    const { items, losses } = readMoodleXml(XML_EDGES);
    expect(losses.filter(({ omitted }) => omitted).map(({ item, reason }) => [item, reason])).toStrictEqual([
      ["Cloze", "item"],
    ]);
    const several = items.find(({ item }) => item.title === "Several with feedback")?.item;
    const xml = several === undefined ? "" : writeAsi({ kind: "item", item: several });
    expect(xml).toContain('identifier="correct"');
    expect(xml).toContain('shuffle="false"');
    expect(xml).toContain("<qti-value>2</qti-value></qti-default-value></qti-outcome-declaration>");
    expect(items.map(({ category }) => category)).toStrictEqual(Array(9).fill("$course$/top/Edges"));
  });

  it("leaves out the questions that Moodle refuses, with Moodle's reason, and keeps the rest", () => {
    const { items, losses } = readGift(caseNamed("gift-edges").file);
    expect(caseNamed("gift-edges").moodle.log).toContain("Could not find {...} around answers");
    expect(losses.filter(({ omitted }) => omitted).map(({ item, reason }) => [item, reason])).toStrictEqual([
      ["Broken", "item"],
      ["Bad pair", "item"],
    ]);
    const kept = new Set(caseNamed("gift-edges").moodle.questions.map(({ read }) => read.name));
    // Moodle refuses a credit outside its grades; the reader keeps it as written, which QTI holds.
    expect(items.map(({ item }) => item.title).filter((title) => !kept.has(title))).toStrictEqual(["Off grid"]);
  });

  it("leaves out a question whose refusal stops Moodle's whole import, and keeps the questions before it", () => {
    for (const name of ["gift-weight-error", "gift-one-answer", "gift-number-error", "gift-no-number"]) {
      const testCase = caseNamed(name);
      expect(testCase.moodle.failure).toMatch(/^TypeError/);
      expect(testCase.moodle.questions).toStrictEqual([]);
      const { items, losses } = readGift(testCase.file);
      expect(items.map(({ item }) => item.title)).toStrictEqual(["Fine"]);
      expect(losses.map(({ omitted, reason }) => [omitted, reason])).toStrictEqual([[true, "item"]]);
    }
  });

  it("leaves out a question of Moodle XML at which Moodle stops, and reads past those that Moodle reads past", () => {
    for (const name of ["xml-fraction-error", "xml-number-error", "xml-mark-error", "xml-one-answer"]) {
      const { moodle, file, responses } = caseNamed(name);
      expect(moodle.failure ?? moodle.log, name).toMatch(/^(?:TypeError|dml_write_exception|!! This type)/);
      expect(moodle.questions.map(({ read }) => read.name)).not.toContain("After");
      const { items, losses } = readMoodleXml(file);
      expect(items.map(({ item }) => item.title)).toStrictEqual(["Fine", "After"]);
      expect(losses.map(({ omitted, reason }) => [omitted, reason])).toStrictEqual([[true, "item"]]);
      // Moodle keeps what it saved before it stopped, unless it undoes the import.
      for (const question of moodle.questions) {
        const read = items.find(({ item }) => item.title === question.read.name)?.item;
        if (read !== undefined) expectMoodleGrades(read, responses[question.read.name] ?? [], question.grades);
      }
    }
    for (const name of ["xml-tolerance-error", "xml-no-name", "xml-bad-file", "xml-essay-format"]) {
      const { moodle, file, responses } = caseNamed(name);
      const { items } = readMoodleXml(file);
      // An item without a name is titled by its identifier.
      const titles = moodle.questions.map(({ read }, index) => read.name || `item-${index + 1}`);
      expect(items.map(({ item }) => item.title)).toStrictEqual(titles);
      for (const [index, question] of moodle.questions.entries()) {
        const read = items[index]?.item;
        if (read !== undefined) expectMoodleGrades(read, responses[question.read.name] ?? [], question.grades);
      }
    }
    // Moodle decodes base64 as PHP does, skipping what is not of its alphabet, and keeps an essay's unknown response format.
    expect([...readMoodleXml(caseNamed("xml-bad-file").file).files.values()]).toStrictEqual([
      new TextEncoder().encode("ABC"),
    ]);
    const essay = readMoodleXml(caseNamed("xml-essay-format").file);
    expect(essay.losses.map(({ item, reason }) => [item, reason])).toStrictEqual([["item-2", "setting"]]);
    expect(writeMoodleXml(essay.items).text).toContain("<responseformat>editor</responseformat>");
    expect(caseNamed("xml-essay-format").moodle.questions[1]?.xml).toContain("<responseformat>canvas</responseformat>");
  });

  it("finds the missing word in a text of any characters, and keeps a text's characters within XML", () => {
    const body = (imported: ImportedItems) => {
      const item = imported.items[0]?.item;
      const xml = item === undefined ? "" : writeAsi({ kind: "item", item });
      return xml.slice(xml.indexOf("<qti-item-body>"), xml.indexOf("</qti-item-body>"));
    };
    // The text holds every character from U+E000, where the reader once looked for one that it did not hold.
    const late = Array.from({ length: 0x2000 }, (_, offset) => String.fromCharCode(0xe000 + offset)).join("");
    const missing = readGift(`{=cat} sat.${late}`);
    expect(body(missing)).toMatch(/^<qti-item-body><div><qti-text-entry-interaction [^>]*\/> sat\./);
    const replaced =
      "The question holds characters that XML does not allow, such as control characters: each is U+FFFD.";
    expect(missing.losses.map(({ message }) => message)).toStrictEqual([replaced]);
    // A control character, which XML does not allow, and two low surrogates, which no UTF-8 holds.
    const control = readGift("Bell \u0007 and \uDC01\uDC02{=a}");
    expect(body(control)).toContain("<div>Bell \uFFFD and \uFFFD\uFFFD</div>");
    expect(control.losses.map(({ message }) => message)).toStrictEqual([replaced]);
  });

  it("writes an infinite number in QTI's form, and leaves out a question whose item does not read", () => {
    const [infinite] = readGift("Big {#1e400}").items;
    if (infinite === undefined) throw new Error("The question reads.");
    expect(writeAsi({ kind: "item", item: infinite.item })).toContain(
      '<qti-base-value base-type="float">INF</qti-base-value>',
    );
    expect(scoreOf(infinite.item, { text: "1" })).toBe(0);
    const question = (type: string, inner: string) =>
      `<question type="${type}"><name><text>${type}</text></name><questiontext format="html"><text>Q</text></questiontext>${inner}</question>`;
    const { items, losses } = readMoodleXml(
      `<quiz>${question("description", "<defaultgrade>1e400</defaultgrade>")}${question("essay", "<responsefieldlines>1.5</responsefieldlines>")}${question("essay", "")}</quiz>`,
    );
    expect(items.map(({ item }) => item.title)).toStrictEqual(["description", "essay"]);
    expect(losses.map(({ index, item, omitted, reason }) => [index, item, omitted, reason])).toStrictEqual([
      [1, "essay", true, "item"],
    ]);
    expect(losses[0]?.message).toMatch(/^The question does not form a QTI item: The attribute expected-lines/);
  });
});

describe("writeGift", () => {
  it("writes the file that the fixture holds, which Moodle read", () => {
    expect(writeGift(buildWrittenItems(), WRITE_OPTIONS).text).toBe(caseNamed("gift-written").file);
    expect(buildMoodleCases().cases.map(({ name, file }) => [name, file])).toStrictEqual(
      fixture.cases.map(({ name, file }) => [name, file]),
    );
  });

  it.each([
    ["gift-written", () => writeGift(buildWrittenItems(), WRITE_OPTIONS).losses],
    ["xml-written", () => writeMoodleXml(buildWrittenItems(), XML_WRITE_OPTIONS).losses],
  ] as const)(
    "writes items that Moodle grades as the items score in %s, except where a loss says the scoring changes",
    (name, write) => {
      const items = buildWrittenItems();
      const losses = write();
      const testCase = caseNamed(name);
      for (const { item } of items) {
        const question = testCase.moodle.questions.find(({ read }) => read.name === item.title);
        expect(question, item.title).toBeDefined();
        if (question === undefined) continue;
        const responses = testCase.responses[item.title] ?? [];
        const differs = responses.some(
          (response, index) => Math.abs(scoreOf(item, response) - (question.grades[index] ?? 0)) > 1e-9,
        );
        const scoringLoss = losses.some(
          ({ item: identifier, reason }) => identifier === item.identifier && reason === "scoring",
        );
        expect(differs, item.title).toBe(scoringLoss && item.identifier !== "text-operator");
      }
    },
  );
});

const QTI = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';
const SCORE = `<qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>`;
const MATCH_CORRECT = `<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"/>`;

/** An item of the given content, read by `readAsi`. */
function qtiItem(inner: string, identifier = "item"): AssessmentItem {
  const document = readAsi(
    `<qti-assessment-item ${QTI} identifier="${identifier}" title="Item" adaptive="false" time-dependent="false">${inner}</qti-assessment-item>`,
  );
  if (document.kind !== "item") throw new Error("Not an item.");
  return document.item;
}

/** The text of an item's body without its interactions, as a reader sees it. */
function bodyText(item: AssessmentItem): string {
  const tree = parseXml(writeAsi({ kind: "item", item }));
  const body = children(tree, "qti-item-body")[0];
  const strip = (nodes: readonly XmlNode[]): string =>
    nodes
      .map((node) =>
        node.kind === "element"
          ? node.name.endsWith("-interaction")
            ? ""
            : strip(node.children)
          : node.kind === "text"
            ? node.value
            : "",
      )
      .join("");
  return body === undefined ? "" : strip(body.children);
}

function choiceTexts(item: AssessmentItem): string[] {
  const tree = parseXml(writeAsi({ kind: "item", item }));
  return descendants(tree, ({ name }) => name === "qti-simple-choice" || name === "qti-inline-choice").map((choice) =>
    textOf(choice.children),
  );
}

describe("the content of a question", () => {
  it("keeps QTI's HTML, gives the content of other elements to their parents, and leaves out code, each with a loss", () => {
    const { items, losses } = readGift(HTML_EDGES.markup);
    const item = items[0]?.item;
    expect(item === undefined ? "" : writeAsi({ kind: "item", item })).toContain(
      '<p class="lead">A red <b>word</b></p><div><img src="a.png" alt=""/></div>',
    );
    expect(losses.map(({ reason, message }) => [reason, message])).toStrictEqual([
      ["content", "The elements font are not QTI content where they stand: their content is kept without them."],
      ["content", "The elements script are not QTI content: they are left out with what they hold."],
      ["content", "The attributes style are not QTI content or have invalid values: they are left out."],
    ]);
  });

  it("keeps MathML, tables, lists and figures, and gives up an element without the children that QTI needs", () => {
    const { items, losses } = readGift(HTML_EDGES.structure);
    const item = items[0]?.item;
    expect(item === undefined ? "" : writeAsi({ kind: "item", item })).toContain(
      '<qti-item-body><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mtext/></math><table/><ul/><dl><dt>t</dt></dl><figure><figcaption>c</figcaption><img src="a.png" alt=""/></figure><p id="a" data-x="1">one</p><p>two</p><table><tbody><tr><td>cell</td></tr></tbody></table><qti-choice-interaction',
    );
    expect(losses.map(({ message }) => message)).toStrictEqual([
      "The elements tbody are not QTI content where they stand: their content is kept without them.",
      "The elements span, svg are not QTI content: they are left out with what they hold.",
      "The attributes id, colspan are not QTI content or have invalid values: they are left out.",
    ]);
  });

  it("shows Moodle's auto-format with its line breaks, plain text as text, and Markdown as plain text with a loss", () => {
    const { items, losses } = readGift(
      "::A::One\\ntwo{=x ~y}\n\n::B::[plain]<b>bold</b>{=x ~y}\n\n::C::[markdown]**strong**{=x ~y}",
    );
    expect(items.map(({ item }) => bodyText(item))).toStrictEqual(["One\ntwo", "<b>bold</b>", "**strong**"]);
    expect(items[0]?.item === undefined ? "" : writeAsi({ kind: "item", item: items[0].item })).toContain(
      "<div>One<br/>\ntwo</div>",
    );
    expect(losses.map(({ item, reason }) => [item, reason])).toStrictEqual([["item-3", "content"]]);
  });

  it("puts a missing word's interaction in its line, and keeps the blank where the interaction cannot stand", () => {
    const { items } = readGift(
      "::A::The {=cat ~dog} sat.\n\n::B::Pick {~%50%a ~%50%b} both.\n\n::C::[html]<p>Two and <b>{=2}</b> make four.</p>",
    );
    const xml = items.map(({ item }) => writeAsi({ kind: "item", item }));
    expect(xml[0]).toContain("<div>The <qti-inline-choice-interaction");
    expect(xml[1]).toContain("<div>Pick _____ both.</div><qti-choice-interaction");
    expect(xml[2]).toContain(
      '<p>Two and <b><qti-text-entry-interaction response-identifier="RESPONSE" base-type="string"/></b> make four.</p>',
    );
  });

  it("converts an element without the children that QTI needs once, and keeps the missing word and identifiers within it", () => {
    // Each details lacks its summary, so its content goes to its parent; tried again for each one around it, the time doubled
    // with each level.
    expect(readGift(`[html]${"<details>".repeat(40)}x${"</details>".repeat(40)}{}`).items).toHaveLength(1);
    const { items, losses } = readGift(
      "::Q::[html]<details><p id='a'>The {=cat} sat.</p></details><p id='a'>Again.</p>",
    );
    const item = items[0]?.item;
    expect(item === undefined ? "" : writeAsi({ kind: "item", item })).toContain(
      '<qti-item-body><div><p id="a">The <qti-text-entry-interaction response-identifier="RESPONSE" base-type="string"/> sat.</p></div><p>Again.</p></qti-item-body>',
    );
    expect(losses.map(({ message }) => message)).toStrictEqual([
      "The elements details are not QTI content where they stand: their content is kept without them.",
      "The attributes id are not QTI content or have invalid values: they are left out.",
    ]);
  });

  it("labels the choices of a true-false question as the option says", () => {
    const { items } = readGift("Is it?{T}", { trueFalseLabels: { true: "Benar", false: "Salah" } });
    expect(items.map(({ item }) => choiceTexts(item))).toStrictEqual([["Benar", "Salah"]]);
  });

  it("names an item by its identifier in the bank when it is a QTI identifier, else by its position", () => {
    const { items } = readGift(
      "// [id:alpha]\n::A::a{}\n\n// [id:alpha]\n::B::b{}\n\n// [id:not an id]\n::C::c{}\n\n::D::d{}",
    );
    expect(items.map(({ item }) => item.identifier)).toStrictEqual(["alpha", "item-2", "item-3", "item-4"]);
  });
});

describe("writeGift and the items that do not convert", () => {
  it("leaves out an item of an interaction that GIFT lacks, of several interactions, or of template variables", () => {
    const order = qtiItem(
      `<qti-response-declaration identifier="RESPONSE" cardinality="ordered" base-type="identifier"/>${SCORE}<qti-item-body><qti-order-interaction response-identifier="RESPONSE"><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-order-interaction></qti-item-body>`,
      "order",
    );
    const two = qtiItem(
      `<qti-response-declaration identifier="A" cardinality="single" base-type="string"/><qti-response-declaration identifier="B" cardinality="single" base-type="string"/><qti-item-body><p><qti-text-entry-interaction response-identifier="A"/><qti-text-entry-interaction response-identifier="B"/></p></qti-item-body>`,
      "two",
    );
    const template = qtiItem(
      `<qti-template-declaration identifier="T" cardinality="single" base-type="integer"/><qti-item-body><p>x</p></qti-item-body>`,
      "template",
    );
    const { text, losses } = writeGift([{ item: order }, { item: two }, { item: template }]);
    expect(text).toBe("");
    expect(losses.map(({ index, item, omitted, reason }) => [index, item, omitted, reason])).toStrictEqual([
      [0, "order", true, "item"],
      [1, "two", true, "item"],
      [2, "template", true, "item"],
    ]);
    expect(losses[0]?.message).toBe("The qti-order-interaction has no question type in GIFT or Moodle XML.");
  });

  it("leaves out an item that calls an operator not registered, and converts it with the operators registered", () => {
    const items = buildWrittenItems().filter(({ item }) => item.identifier === "text-operator");
    const { losses } = writeGift(items);
    expect(losses.map(({ omitted, reason }) => [omitted, reason])).toStrictEqual([[true, "item"]]);
    expect(losses[0]?.message).toMatch(/^The item's response processing fails: /);
    expect(writeGift(items, WRITE_OPTIONS).text).toContain("=Paris\n");
  });

  it("holds a writer to the limit maxAnswers, the only limit that it takes", () => {
    const item = qtiItem(
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>A</qti-value></qti-correct-response></qti-response-declaration>${SCORE}<qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1" shuffle="false"><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-choice-interaction></qti-item-body><qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"/>`,
    );
    expect(writeGift([{ item }], { limits: { maxAnswers: 2 } }).text).toContain("=a");
    const { losses } = writeGift([{ item }], { limits: { maxAnswers: 1 } });
    expect(losses.map(({ omitted, reason }) => [omitted, reason])).toStrictEqual([[true, "item"]]);
    expect(losses[0]?.message).toBe("The interaction has 2 choices, over the limit maxAnswers of 1.");
    expect(
      writeMoodleXml([{ item }], { limits: { maxAnswers: 1 } }).losses.map(({ omitted }) => omitted),
    ).toStrictEqual([true]);
    const wrong = JSON.parse('{"limits": {"maxBytes": 5}}');
    expect(() => writeGift([{ item }], wrong)).toThrow("maxBytes");
    expect(() => writeMoodleXml([{ item }], wrong)).toThrow("maxBytes");
  });

  it("writes a credit outside Moodle's grades as the nearest grade, with a loss", () => {
    const item = qtiItem(
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-mapping default-value="0"><qti-map-entry map-key="A" mapped-value="1"/><qti-map-entry map-key="B" mapped-value="0.35"/></qti-mapping></qti-response-declaration>${SCORE}<qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1" shuffle="true"><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-choice-interaction></qti-item-body><qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/map_response.xml"/>`,
    );
    const { text, losses } = writeGift([{ item }]);
    expect(text).toContain("~%33.33333%b");
    expect(losses.map(({ reason, message }) => [reason, message])).toStrictEqual([
      ["scoring", "The credit 35% of the choice B is not one of Moodle's grades: it is written as 33.33333%."],
    ]);
  });

  it("lists case that GIFT loses, an open bound of a tolerance, and feedback that no answer singles out", () => {
    const cased = qtiItem(
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"><qti-correct-response><qti-value>Paris</qti-value></qti-correct-response></qti-response-declaration>${SCORE}<qti-item-body><p>Capital: <qti-text-entry-interaction response-identifier="RESPONSE"/></p></qti-item-body>${MATCH_CORRECT}`,
      "cased",
    );
    const open = qtiItem(
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="float"/>${SCORE}<qti-item-body><p>x: <qti-text-entry-interaction response-identifier="RESPONSE"/></p></qti-item-body><qti-response-processing><qti-response-condition><qti-response-if><qti-equal tolerance-mode="absolute" tolerance="1" include-upper-bound="false"><qti-base-value base-type="float">5</qti-base-value><qti-variable identifier="RESPONSE"/></qti-equal><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value></qti-response-if></qti-response-condition></qti-response-processing>`,
      "open",
    );
    const blank = qtiItem(
      `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>A</qti-value></qti-correct-response></qti-response-declaration>${SCORE}<qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier"/><qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1" shuffle="true"><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-choice-interaction></qti-item-body><qti-response-processing><qti-response-condition><qti-response-if><qti-is-null><qti-variable identifier="RESPONSE"/></qti-is-null><qti-set-outcome-value identifier="FEEDBACK"><qti-base-value base-type="identifier">blank</qti-base-value></qti-set-outcome-value></qti-response-if><qti-response-else-if><qti-match><qti-variable identifier="RESPONSE"/><qti-correct identifier="RESPONSE"/></qti-match><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value></qti-response-else-if></qti-response-condition></qti-response-processing><qti-modal-feedback outcome-identifier="FEEDBACK" show-hide="show" identifier="blank"><qti-content-body>Answer it.</qti-content-body></qti-modal-feedback>`,
      "blank",
    );
    const { text, losses } = writeGift([{ item: cased }, { item: open }, { item: blank }]);
    expect(text).toContain("=Paris\n");
    expect(text).toContain("=5:1\n");
    expect(losses.map(({ item, reason }) => [item, reason])).toStrictEqual([
      ["cased", "scoring"],
      ["open", "scoring"],
      ["open", "scoring"],
      ["blank", "feedback"],
    ]);
  });
});

describe("the rules of an item that a writer meets", () => {
  it("writes each rule that a question holds, and lists each other with its reason, alike in both formats", () => {
    const items = buildRuleItems().map((item) => ({ item }));
    const gift = writeGift(items, WRITE_OPTIONS);
    const xml = writeMoodleXml(items, WRITE_OPTIONS);
    const summary = (losses: readonly ConversionLoss[]) =>
      losses.map(({ item, omitted, reason }) => `${item} ${omitted ? "omitted" : reason}`);
    expect(summary(xml.losses)).toStrictEqual([
      "fixed-and-limited setting",
      "fixed-and-limited setting",
      "one-choice omitted",
      "no-credit omitted",
      "match-all-or-nothing scoring",
      "match-all-or-nothing scoring",
      "match-all-or-nothing setting",
      "match-all-or-nothing content",
      "match-two-right scoring",
      "match-two-right setting",
      "match-empty omitted",
      "numbers scoring",
      "number-no-credit omitted",
      "text-rules scoring",
      "text-rules scoring",
      "text-no-credit omitted",
      "essay-scored setting",
      "essay-scored setting",
      "essay-scored scoring",
      "uri-entry omitted",
      "undeclared omitted",
      "description-feedback feedback",
      "content-after content",
      "content-after content",
      "operator-number scoring",
    ]);
    // GIFT loses what Moodle XML loses, and what GIFT itself does not say: shuffling, a mark, case, an essay's options.
    const own = gift.losses.filter(({ message }) => message.startsWith("GIFT"));
    expect(gift.losses.filter((loss) => !own.includes(loss))).toStrictEqual(xml.losses);
    expect(new Set(own.map(({ item }) => item))).toStrictEqual(
      new Set([
        "twelve-choices",
        "labels-of-markup",
        "match-all-or-nothing",
        "match-two-right",
        "text-format-name",
        "essay-scored",
        "content-after",
      ]),
    );
    for (const answers of [
      "~%-100%c11\n",
      "= -> T2\n",
      "=100:10\n\t=%50%51:2\n\t=%50%3.14:0\n",
      "=10:2\n",
      "=Alpha\n\t=%50%Beta\n",
    ]) {
      expect(gift.text).toContain(answers);
    }
    expect(xml.text).toContain("<responseformat>monospaced</responseformat>");
    // An answer that starts as a format's name would read as that format: its own format says it is plain.
    expect(gift.text).toContain("=[plain][html]x\n");
  });

  it("writes a number's tolerances and a credit's sums so that the items read back score as the item does", () => {
    const items = buildRuleItems().map((item) => ({ item }));
    const read = readGift(writeGift(items, WRITE_OPTIONS).text).items;
    const expectSameScores = (name: string, responses: readonly CaseResponse[]) => {
      const item = items.find(({ item }) => item.identifier === name)?.item;
      const again = read.find(({ item }) => item.identifier === name)?.item;
      if (item === undefined || again === undefined) throw new Error(`No item ${name}.`);
      for (const response of responses) {
        expect(scoreOf(again, response), `${name}, ${JSON.stringify(response)}`).toBeCloseTo(
          scoreOf(item, response),
          9,
        );
      }
    };
    expectSameScores("numbers", [{ text: "95" }, { text: "52" }, { text: "3.14" }, { text: "48.5" }]);
    expectSameScores("operator-float", [{ text: "0.505" }, { text: "0.49" }]);
    expectSameScores("twelve-choices", [
      { choices: [0, 1, 2] },
      { choices: [...Array(11).keys()] },
      { choices: [0, 11] },
    ]);
  });
});

describe("errors", () => {
  it("refuses arguments and options of other types, as JSON passes them", () => {
    const wrong = JSON.parse(
      '{"input": 3, "options": null, "unknown": {"labels": 1}, "limits": {"limits": {"maxBytes": "1"}}}',
    );
    expect(() => readGift(wrong.input)).toThrow(DataError);
    expect(() => readGift("x", wrong.options)).toThrow(DataError);
    expect(() => readGift("x", wrong.unknown)).toThrow(DataError);
    expect(() => readGift("x", wrong.limits)).toThrow(
      "The options object is invalid at limits.maxBytes: expected a number",
    );
    expect(() => writeGift(JSON.parse("{}"))).toThrow(DataError);
    expect(() => writeGift([JSON.parse("null")])).toThrow(DataError);
    expect(() => writeGift([], JSON.parse('{"customOperators": {}}'))).toThrow(DataError);
    expect(() => writeGift([], JSON.parse('{"bogus":1}'))).toThrow('unexpected property "bogus"');
    expect(() => writeGift([], JSON.parse('{"limits":{"maxBytes":1}}'))).toThrow('unexpected property "maxBytes"');
    expect(() => readGift("", JSON.parse('{"bogus":1}'))).toThrow('unexpected property "bogus"');
    expect(() => readMoodleXml("", JSON.parse('{"limits":{"maxByte":1}}'))).toThrow('unexpected property "maxByte"');
    const item = qtiItem(`<qti-item-body><p>x</p></qti-item-body>`);
    expect(() => writeGift([{ item, category: JSON.parse("5") }])).toThrow(DataError);
    expect(() => writeMoodleXml([{ item, tags: JSON.parse("[1]") }])).toThrow(DataError);
  });

  it("refuses Moodle XML that is not a file of questions, or that declares a DOCTYPE", () => {
    expect(() => readMoodleXml("<questions/>")).toThrow(ReadError);
    expect(() => readMoodleXml("<quiz>")).toThrow(ReadError);
    expect(() => readMoodleXml('<!DOCTYPE quiz [<!ENTITY a "b">]><quiz/>')).toThrow(
      expect.objectContaining({ limit: "doctype" }),
    );
    expect(() => readMoodleXml(JSON.parse("5"))).toThrow(DataError);
    expect(() => writeMoodleXml([], JSON.parse('{"files": {"a": 1}}'))).toThrow(DataError);
    expect(readMoodleXml("<quiz/>")).toStrictEqual({ items: [], files: new Map(), losses: [] });
  });

  it("reads UTF-8 bytes without their mark, and refuses other bytes as Moodle does", () => {
    const bytes = new TextEncoder().encode("﻿::Á::Unicode text{=ä ~ö}");
    expect(readGift(bytes).items.map(({ item }) => item.title)).toStrictEqual(["Á"]);
    expect(() => readGift(new Uint8Array([0x3a, 0x3a, 0xff, 0x3a, 0x3a]))).toThrow(ReadError);
  });

  it("refuses a file past each limit with the limit's name", () => {
    const limit = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof SecurityError ? [error.limit, error.maximum] : String(error);
      }
      return "no error";
    };
    expect(limit(() => readGift("Q{}", { limits: { maxBytes: 2 } }))).toStrictEqual(["maxBytes", 2]);
    const question =
      '<question type="essay"><name><text>q</text></name><questiontext><text>q</text></questiontext></question>';
    expect(
      limit(() => readMoodleXml(`<quiz>${question.repeat(3)}</quiz>`, { limits: { maxQuestions: 2 } })),
    ).toStrictEqual(["maxQuestions", 2]);
    const answers = '<answer fraction="100"><text>a</text></answer>'.repeat(3);
    const choice = `<question type="multichoice"><name><text>q</text></name>${answers}</question>`;
    expect(limit(() => readMoodleXml(`<quiz>${choice}</quiz>`, { limits: { maxAnswers: 2 } }))).toStrictEqual([
      "maxAnswers",
      2,
    ]);
    expect(limit(() => readMoodleXml(`<quiz>${question}</quiz>`, { limits: { maxBytes: 20 } }))).toStrictEqual([
      "maxBytes",
      20,
    ]);
    expect(limit(() => readGift(new Uint8Array(3), { limits: { maxBytes: 2 } }))).toStrictEqual(["maxBytes", 2]);
    // Two, three and four bytes of UTF-8: the limit counts bytes, not the characters of the string.
    expect(limit(() => readGift("é€😀{}", { limits: { maxBytes: 10 } }))).toStrictEqual(["maxBytes", 10]);
    expect(readGift("é€😀{}", { limits: { maxBytes: 11 } }).items).toHaveLength(1);
    expect(limit(() => readGift("a{}\n\nb{}\n\nc{}", { limits: { maxQuestions: 2 } }))).toStrictEqual([
      "maxQuestions",
      2,
    ]);
    expect(limit(() => readGift("a{~1 ~2 =3}", { limits: { maxAnswers: 2 } }))).toStrictEqual(["maxAnswers", 2]);
    expect(limit(() => readGift("[html]<b>a</b><i>b</i>{}", { limits: { maxNodes: 3 } }))).toStrictEqual([
      "maxNodes",
      3,
    ]);
    expect(limit(() => readGift(`[html]${"<span>".repeat(5)}x{}`, { limits: { maxDepth: 4 } }))).toStrictEqual([
      "maxDepth",
      4,
    ]);
    expect(limit(() => readGift(`[html]${"<b>a</b>".repeat(3)}{}`, { limits: { maxTextTags: 5 } }))).toStrictEqual([
      "maxTextTags",
      5,
    ]);
    expect(() => readGift("x", { limits: { maxDepth: 257 } })).toThrow(DataError);
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = readFileSync(new URL("../../../docs/runtime/item-formats.md", import.meta.url), "utf8");
    const modules = {
      "@assesskit/runtime/asi": await import("../src/asi/index.js"),
      "@assesskit/runtime/item-formats": await import("../src/item-formats/index.js"),
    };
    expect(await runGuideSamples(guide, modules)).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  it("writes and reads back any text of a question and of its answers, GIFT's marks included", () => {
    fc.assert(
      fc.property(markedText, markedText, markedText, (text, first, second) => {
        const escapeHtml = (value: string) =>
          value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        const item = qtiItem(
          `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>A</qti-value></qti-correct-response></qti-response-declaration>${SCORE}<qti-item-body><p>${escapeHtml(text)}</p><qti-choice-interaction response-identifier="RESPONSE" max-choices="1" shuffle="true"><qti-simple-choice identifier="A">${escapeHtml(first)}</qti-simple-choice><qti-simple-choice identifier="B">${escapeHtml(second)}</qti-simple-choice></qti-choice-interaction></qti-item-body>${MATCH_CORRECT}`,
        );
        const { items, losses } = readGift(writeGift([{ item }]).text);
        expect(losses).toStrictEqual([]);
        const [read] = items;
        expect(read === undefined ? [] : [bodyText(read.item), ...choiceTexts(read.item)]).toStrictEqual([
          text,
          first.trim(),
          second.trim(),
        ]);
      }),
      FUZZ,
    );
  });

  it("reads any credits of Moodle's list as Moodle grades them, and writes them back alike", () => {
    fc.assert(
      fc.property(weightedChoices, ({ gift, answers, single }) => {
        const [read] = readGift(gift).items;
        const [again] = readGift(writeGift(read === undefined ? [] : [read]).text).items;
        if (read === undefined || again === undefined) throw new Error("A question of credits converts.");
        const all = [...Array(answers).keys()];
        const responses: CaseResponse[] = single
          ? all.map((choice) => ({ choice }))
          : all.map((choice) => ({ choices: all.slice(0, choice + 1) }));
        for (const response of responses)
          expect(scoreOf(again.item, response)).toBeCloseTo(scoreOf(read.item, response), 9);
      }),
      FUZZ,
    );
  });

  it("reads mutated Moodle XML or refuses it with a ReadError or a SecurityError, and writes back what it reads", () => {
    const written = caseNamed("xml-written").file;
    fuzzReader(fc.constantFrom(XML_EDGES, written), (input) => writeMoodleXml(readMoodleXml(input).items));
  });

  it("reads any text, and mutated files, or refuses them with a SecurityError, and writes back what it reads", () => {
    const edges = caseNamed("gift-edges").file;
    fc.assert(
      fc.property(
        fc.oneof(
          markedText,
          giftMutations.map((changes) => mutateText(edges, changes)),
        ),
        (text) => {
          expectOutcome(() => writeGift(readGift(text).items), [SecurityError]);
        },
      ),
      FUZZ,
    );
  });
});
