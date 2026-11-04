import type { ItemKey } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import {
  buildContainer,
  buildRecord,
  buildSingle,
  type FileValue,
  type Value,
  type ValueDeclaration,
  writeWireValue,
} from "@assesskit/runtime/values";
import { afterEach, describe, expect, inject, it } from "vitest";
import { ID_MESSAGES } from "../src/messages/id/index.js";
import { mountSubmission, type SubmissionOptions } from "../src/player/index.js";
import { HOST_SHADOW_RULE } from "../src/player/internal.js";
import type { Submission, SubmissionItem, SubmissionPart, SubmissionValue } from "../src/protocol/index.js";
import { computed, PLAYER_CSS, stylesheet } from "./css-fixture.js";
import { axeViolations, ITEM_PATH, itemBody } from "./renderer-fixture.js";

const { asset } = inject("fixtures");

/** The browsers of a run share the servers, so this file names its paths with a token of its own. */
const TOKEN = crypto.randomUUID();
const ASSETS = `${asset}/content/${TOKEN}/`;
const ITEM_DIRECTORY = `${ASSETS}items/q1/`;
const MATHJAX = `${asset}/mathjax/${TOKEN}/mml-chtml.js`;

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

/** Parses JSON text, so that a test passes input as JavaScript or JSON delivers it. */
const json = (text: string): unknown => JSON.parse(text);

/** Writes a value as the wire value of a submission; the oracle for the form is the runtime's codec. */
function wire(value: Value | null): SubmissionValue {
  if (value === null) return null;
  const declaration: ValueDeclaration =
    value.cardinality === "record"
      ? { cardinality: "record" }
      : { cardinality: value.cardinality, baseType: value.baseType };
  return writeWireValue(value, declaration);
}

const text = (value: string): SubmissionValue => wire(buildSingle("string", value));

/** The body of an item as the scorer view gives it: the candidate's content, then the rubric block of the scorer. */
const ESSAY_BODY =
  itemBody(`<qti-rubric-block view="candidate" use="instructions"><qti-content-body><p>Write about your town.</p></qti-content-body></qti-rubric-block>
  <p>Look at <img src="images/dot.png" alt="A dot"/>.</p>
  <qti-extended-text-interaction response-identifier="RESPONSE"/>
  <qti-rubric-block view="scorer" use="scoring"><qti-content-body><p>Give 0 to 10 points.</p></qti-content-body></qti-rubric-block>`);

const KEY: ItemKey = { ref: "essay", instance: 1 };
const ANSWER = "Dear Sir\nI write about my town.";

/** A response of the essay that the outcome rates. */
function part(overrides: Partial<SubmissionPart> = {}): SubmissionPart {
  return {
    item: KEY,
    responseIdentifier: "RESPONSE",
    presented: true,
    interaction: "extended-text-interaction",
    value: text(ANSWER),
    ...overrides,
  };
}

/** The essay, with a template value and a response that has no key. */
function item(overrides: Partial<SubmissionItem> = {}): SubmissionItem {
  return {
    key: KEY,
    title: "Essay about a town",
    presented: true,
    body: ESSAY_BODY,
    templateValues: [{ identifier: "N", value: wire(buildSingle("integer", 4)) }],
    correctResponses: [{ identifier: "RESPONSE", value: null }],
    ...overrides,
  };
}

/** A submission of an item outcome with one essay, as JSON delivers it. */
function submission(overrides: Partial<Submission> = {}): Submission {
  const whole: Submission = {
    request: "item:essay:1:SCORE",
    outcome: "SCORE",
    mode: "human",
    declaration: {
      cardinality: "single",
      baseType: "float",
      normalMinimum: 0,
      normalMaximum: 10,
      interpretation: "Essay score",
    },
    requestedAt: Date.UTC(2026, 9, 30, 12, 0, 0),
    rubric: [],
    parts: [part()],
    items: [item()],
    ...overrides,
  };
  return json(JSON.stringify(whole)) as Submission;
}

/** Mounts a submission in a host that the page holds, with the options of the tests. */
function show(
  shown: Submission,
  extra: Partial<SubmissionOptions> = {},
  attributes: Readonly<Record<string, string>> = {},
) {
  const host = document.createElement("div");
  for (const [name, value] of Object.entries(attributes)) host.setAttribute(name, value);
  document.body.append(host);
  hosts.push(host);
  const mounted = mountSubmission(host, shown, {
    assets: (path) => `${ASSETS}${path}`,
    stylesheet: stylesheet(PLAYER_CSS),
    itemPath: () => ITEM_PATH,
    ...extra,
  });
  const shadow = host.shadowRoot;
  if (shadow === null) throw new Error("The display has no shadow root.");
  return { host, shadow, mounted };
}

/** Returns the element that matches, which must exist. */
function el(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (found === null) throw new Error(`No element matches ${selector}.`);
  return found;
}

/** Returns the shadow roots of the content that the display draws, in order. */
function contents(shadow: ShadowRoot): ShadowRoot[] {
  return [...shadow.querySelectorAll(".ak-submission-content")].flatMap((host) => host.shadowRoot ?? []);
}

/**
 * Resolves once the first element below a root that matches a selector is there. A display typesets its content after it
 * is shown, and MathJax takes seconds to load in a cold browser, so the test waits for the output and not for a time.
 */
function appears(root: ParentNode & Node, selector: string): Promise<Element> {
  return new Promise((done) => {
    const present = (): boolean => {
      const found = root.querySelector(selector);
      if (found !== null) done(found);
      return found !== null;
    };
    if (present()) return;
    const observer = new MutationObserver(() => {
      if (present()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
  });
}

/** Returns the text of a name and value group of a definition list, by the name. */
function fact(root: ParentNode, name: string): string {
  const group = [...root.querySelectorAll("dl > div")].find((each) => each.querySelector("dt")?.textContent === name);
  if (group === undefined) throw new Error(`The display has no fact ${name}.`);
  return group.querySelector("dd")?.textContent ?? "";
}

/** Returns the parts of the display, one `li` for each response. */
const parts = (shadow: ShadowRoot): Element[] => [...shadow.querySelectorAll("li.ak-submission-part")];

/** Returns the text of the response of the first part. */
const answer = (shadow: ShadowRoot): string => fact(el(shadow, "li.ak-submission-part"), "Response of the candidate");

/** Returns the headings of the display with their levels, in order. */
const headings = (shadow: ShadowRoot): string[] =>
  [...shadow.querySelectorAll("h2, h3, h4")].map(
    (heading) => `${heading.tagName.toLowerCase()} ${heading.textContent}`,
  );

describe("mountSubmission", () => {
  it("shows the outcome, who scores it and its declaration in a shadow root of the host", () => {
    const { host, shadow } = show(submission());
    expect(host.shadowRoot).toBe(shadow);
    const article = el(shadow, "article.ak-submission");
    expect(article.getAttribute("aria-labelledby")).toBe(el(article, "h2").id);
    expect(el(article, "h2").textContent).toBe("Submission to score");
    expect(fact(shadow, "Outcome to score")).toBe("SCORE");
    expect(fact(shadow, "Scored by")).toBe("A person");
    expect(fact(shadow, "Type of outcome")).toBe("single float");
    expect(fact(shadow, "Normal minimum")).toBe("0");
    expect(fact(shadow, "Normal maximum")).toBe("10");
    expect(fact(shadow, "Meaning of the outcome")).toBe("Essay score");
    expect(el(shadow, "dl > div time").getAttribute("datetime")).toBe("2026-10-30T12:00:00.000Z");
    expect(fact(shadow, "Requested at")).toBe("2026-10-30T12:00:00.000Z");
  });

  it("names a machine scorer, a record declaration, the variable reference and the link to a tool", () => {
    const { shadow } = show(
      submission({
        mode: "externalMachine",
        variableIdentifierRef: "http://example.org/ref",
        lti: true,
        declaration: { cardinality: "record" },
      }),
    );
    expect(fact(shadow, "Scored by")).toBe("An external machine");
    expect(fact(shadow, "Type of outcome")).toBe("record");
    expect(fact(shadow, "Variable reference")).toBe("http://example.org/ref");
    expect(el(shadow, ".ak-submission-note").textContent).toBe("This item links to a tool.");
  });

  it("shows the score supplied before, who gave it and when, and nothing of it while the request is pending", () => {
    const supplied = {
      value: wire(buildSingle("float", 7.5)),
      at: Date.UTC(2026, 9, 30, 13, 30, 0),
      scorer: "externalMachine",
    } as const;
    const { shadow } = show(submission({ supplied }));
    expect(fact(shadow, "Earlier score")).toBe("7.5");
    expect(fact(shadow, "Earlier score given by")).toBe("An external machine");
    expect(fact(shadow, "Earlier score given at")).toBe("2026-10-30T13:30:00.000Z");
    expect(() => fact(show(submission()).shadow, "Earlier score")).toThrow("The display has no fact Earlier score.");
    expect(fact(show(submission({ supplied: { ...supplied, value: null } })).shadow, "Earlier score")).toBe("No value");
  });

  it("draws the body of an item in a content root, with its references at the document of the item", () => {
    const asked: string[] = [];
    const { shadow } = show(submission(), {
      itemPath: (key) => {
        asked.push(`${key.ref}#${key.instance}`);
        return ITEM_PATH;
      },
    });
    expect(asked).toEqual(["essay#1"]);
    const [body, scorer] = contents(shadow);
    if (body === undefined || scorer === undefined) throw new Error("The display has fewer content roots.");
    expect(body.textContent).toContain("Write about your town.");
    expect(body.textContent).not.toContain("Give 0 to 10 points.");
    expect(el(body, "img").getAttribute("src")).toBe(`${ITEM_DIRECTORY}images/dot.png`);
    // The interaction is a placeholder until the host gives renderers.
    expect(el(body, "qti-extended-text-interaction").hasAttribute("data-ak-placeholder")).toBe(true);
    // The rubric block that only the scorer sees is drawn for the scorer, in a root of its own.
    expect(scorer.textContent).toContain("Give 0 to 10 points.");
    expect(el(scorer, "qti-rubric-block").getAttribute("data-use")).toBe("scoring");
  });

  it("draws the interactions with the renderers the host gives", () => {
    const interactions: SubmissionOptions["interactions"] = new Map([
      [
        "extended-text-interaction",
        (interaction, renderer) =>
          renderer.element("qti-extended-text-interaction", interaction, [document.createTextNode("[review]")]),
      ],
    ]);
    const { shadow } = show(submission(), { interactions });
    expect(contents(shadow)[0]?.textContent).toContain("[review]");
  });

  it("shows the rubric of the scorer view before the items", () => {
    const rubric = itemBody("<p>Rate the content once.</p><ul><li>Task 1</li></ul>");
    const { shadow } = show(submission({ rubric }));
    expect(headings(shadow).slice(0, 3)).toEqual([
      "h2 Submission to score",
      "h3 Rubric for the scorer",
      "h3 Essay about a town",
    ]);
    expect(contents(shadow)[0]?.textContent).toContain("Rate the content once.");
    expect(contents(shadow)[0]?.querySelectorAll("li")).toHaveLength(1);
    expect(headings(show(submission()).shadow)).not.toContain("h3 Rubric for the scorer");
  });

  it("shows each response the outcome rates, in the order of the covers, with its label, variable and kind", () => {
    const letter: ItemKey = { ref: "letter", instance: 1 };
    const { shadow } = show(
      submission({
        parts: [
          part({ label: "Task 1: essay" }),
          part({ item: letter, label: "Task 2: letter", value: text("Hello Anna") }),
          part({ responseIdentifier: "SECOND", interaction: undefined, value: null }),
        ],
        items: [item(), item({ key: letter, title: "Letter to a friend", body: itemBody("<p>Write a letter.</p>") })],
      }),
    );
    expect(headings(shadow).filter((heading) => /^h[34] /.test(heading) && !heading.includes("Rubric"))).toEqual([
      "h3 Essay about a town",
      "h4 Task 1: essay",
      "h4 SECOND",
      "h4 Correct responses",
      "h4 Template values",
      "h3 Letter to a friend",
      "h4 Task 2: letter",
      "h4 Correct responses",
      "h4 Template values",
    ]);
    // The parts of an item stand under it, so the parts of the first item come before those of the second.
    const [first, second, third] = parts(shadow);
    if (first === undefined || second === undefined || third === undefined) throw new Error("Fewer than 3 parts.");
    expect(fact(first, "Response variable")).toBe("RESPONSE");
    expect(fact(first, "Kind of interaction")).toBe("extended-text-interaction");
    expect(fact(first, "Response of the candidate")).toBe(ANSWER);
    expect(fact(second, "Response of the candidate")).toBe("No response");
    expect(() => fact(second, "Kind of interaction")).toThrow("The display has no fact Kind of interaction.");
    expect(fact(third, "Response of the candidate")).toBe("Hello Anna");
  });

  it("keeps the line breaks of a long answer and takes the direction of its text", () => {
    // Arabic, the first letters of the alphabet: a right-to-left text without its letters in the source.
    const answerText = `Line one\n\n${String.fromCodePoint(0x627, 0x628, 0x62a, 0x62b)}`;
    const { shadow } = show(submission({ parts: [part({ value: text(answerText) })] }));
    const shown = el(el(shadow, "li.ak-submission-part"), ".ak-submission-text");
    expect(shown.textContent).toBe(answerText);
    expect(shown.getAttribute("dir")).toBe("auto");
    expect(computed(shown, "white-space")).toBe("pre-wrap");
  });

  it("says that the candidate was not shown an item, and draws no content for it", () => {
    const { shadow } = show(
      submission({
        parts: [part({ presented: false, value: null })],
        items: [item({ presented: false, body: [], templateValues: [], correctResponses: [] })],
      }),
    );
    expect(el(shadow, ".ak-submission-note").textContent).toBe("The candidate was not shown this item.");
    expect(contents(shadow)).toHaveLength(0);
    expect(headings(shadow)).toEqual(["h2 Submission to score", "h3 Essay about a town", "h4 RESPONSE"]);
    expect(answer(shadow)).toBe("No response");
  });

  it("shows the correct responses and the template values of an item, and NULL as no value", () => {
    const { shadow } = show(
      submission({
        items: [
          item({
            correctResponses: [
              { identifier: "RESPONSE", value: wire(buildSingle("identifier", "B")) },
              { identifier: "OTHER", value: null },
            ],
          }),
        ],
      }),
    );
    const [correct, template] = [...shadow.querySelectorAll("dl.ak-submission-variables")];
    if (correct === undefined || template === undefined) throw new Error("The display lacks a list of variables.");
    expect(fact(correct, "RESPONSE")).toBe("B");
    expect(fact(correct, "OTHER")).toBe("No value");
    expect(fact(template, "N")).toBe("4");
  });

  it("shows a container as a list that keeps the order, and a record as names and values", () => {
    const ordered = show(
      submission({ parts: [part({ value: wire(buildContainer("ordered", "integer", [3, 1, 2])) })] }),
    );
    const list = el(ordered.shadow, "li.ak-submission-part ol.ak-submission-list");
    expect([...list.querySelectorAll("li")].map((entry) => entry.textContent)).toEqual(["3", "1", "2"]);
    const multiple = show(
      submission({ parts: [part({ value: wire(buildContainer("multiple", "identifier", ["A", "C"])) })] }),
    );
    expect(multiple.shadow.querySelectorAll("li.ak-submission-part ul.ak-submission-list > li")).toHaveLength(2);
    const fields = buildRecord([
      ["a", buildSingle("integer", 1)],
      ["b", buildSingle("boolean", true)],
    ]);
    const named = show(submission({ parts: [part({ value: wire(fields) })] }));
    const dl = el(named.shadow, "li.ak-submission-part dl.ak-submission-fields");
    expect([fact(dl, "a"), fact(dl, "b")]).toEqual(["1", "true"]);
  });

  it("shows the other base types in their lexical form", () => {
    const cases: readonly (readonly [Value, string])[] = [
      [buildSingle("point", [10, 20]), "10 20"],
      [buildSingle("directedPair", ["A", "B"]), "A B"],
      [buildSingle("float", 2.5), "2.5"],
      [buildSingle("duration", 90), "90"],
      [buildSingle("uri", "http://example.org/x"), "http://example.org/x"],
    ];
    for (const [value, expected] of cases) {
      expect(answer(show(submission({ parts: [part({ value: wire(value) })] })).shadow)).toBe(expected);
    }
  });

  it("shows a file by its type: images, audio and video play, and anything else is a link that opens in a tab of its own", () => {
    const file = (mimeType: string, fileName?: string): FileValue => ({
      reference: `uploads/${mimeType}`,
      mimeType,
      ...(fileName === undefined ? {} : { fileName }),
    });
    const files = { url: (value: FileValue) => `${ASSETS}${value.reference}` };
    const shown = (value: FileValue): Element => {
      const { shadow } = show(submission({ parts: [part({ value: wire(buildSingle("file", value)) })] }), { files });
      return el(shadow, "li.ak-submission-part .ak-submission-value > *");
    };
    const image = shown(file("image/png", "drawing.png"));
    expect([image.tagName, image.getAttribute("src"), image.getAttribute("alt")]).toEqual([
      "IMG",
      `${ASSETS}uploads/image/png`,
      "drawing.png",
    ]);
    const audio = shown(file("audio/wav; codecs=1", "speech.wav"));
    expect([audio.tagName, audio.hasAttribute("controls"), audio.getAttribute("aria-label")]).toEqual([
      "AUDIO",
      true,
      "speech.wav",
    ]);
    const video = shown(file("video/mp4"));
    expect([video.tagName, video.getAttribute("aria-label")]).toEqual(["VIDEO", "Submitted file"]);
    const link = shown(file("application/pdf", "essay.pdf"));
    expect([link.tagName, link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel")]).toEqual([
      "A",
      `${ASSETS}uploads/application/pdf`,
      "_blank",
      "noopener noreferrer",
    ]);
    expect(link.textContent).toBe("essay.pdf");
    // A page that a candidate uploaded is a link and never a frame.
    expect(shown(file("text/html", "page.html")).tagName).toBe("A");
  });

  it("shows a file as its name when the host gives no way to open it", () => {
    const file = { reference: "uploads/1", mimeType: "audio/wav", fileName: "speech.wav" };
    const { shadow } = show(submission({ parts: [part({ value: wire(buildSingle("file", file)) })] }));
    expect(answer(shadow)).toBe("speech.wav");
    expect(shadow.querySelector("li.ak-submission-part a, li.ak-submission-part audio")).toBeNull();
  });

  it("refuses a file URL that is not an http or https URL, and one that is not a string", () => {
    const file = { reference: "uploads/1", mimeType: "image/png" };
    const withFile = submission({ parts: [part({ value: wire(buildSingle("file", file)) })] });
    expect(() => show(withFile, { files: { url: () => "javascript:alert(1)" } })).toThrow(
      new DataError('The URL that files.url returned must be an http or https URL, found "javascript:alert(1)".'),
    );
    expect(() => show(withFile, { files: { url: () => json("5") as string } })).toThrow(
      new DataError("The URL that files.url returned must be a string, found 5."),
    );
  });

  it("is read-only: nothing in the display, in its content roots included, takes input", () => {
    const { shadow } = show(submission({ rubric: itemBody("<p>Rate.</p>") }));
    const controls = "input, textarea, select, button, [contenteditable], [tabindex]";
    expect(shadow.querySelectorAll(controls)).toHaveLength(0);
    for (const root of contents(shadow)) expect(root.querySelectorAll(controls)).toHaveLength(0);
  });

  it("draws the content as the renderer keeps it for a candidate: no script, no event handler, no foreign origin", () => {
    const hostile = itemBody(
      '<p>Text <a href="javascript:alert(1)" onclick="alert(2)">link</a><img src="//stranger.invalid/x.png" alt=""/></p>',
    );
    const { shadow } = show(submission({ items: [item({ body: hostile })] }));
    const [body] = contents(shadow);
    expect(body?.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(body?.querySelector("a")?.hasAttribute("onclick")).toBe(false);
    expect(body?.querySelector("img")?.hasAttribute("src")).toBe(false);
  });

  it("typesets the expressions of the content when the host gives MathJax", async () => {
    const math = itemBody("<p>Half of x is <m:math><m:mfrac><m:mi>x</m:mi><m:mn>2</m:mn></m:mfrac></m:math>.</p>");
    const { shadow } = show(submission({ items: [item({ body: math })] }), { mathjax: MATHJAX });
    const [content] = contents(shadow);
    if (content === undefined) throw new Error("The display has no content root.");
    expect(await appears(content, "mjx-container mjx-frac")).toBeInstanceOf(Element);
  });

  it("shows another submission when updated, and keeps the display when the new one is wrong", () => {
    const { shadow, mounted } = show(submission());
    const first = contents(shadow);
    mounted.update(submission({ parts: [part({ value: text("Another answer") })] }));
    expect(answer(shadow)).toBe("Another answer");
    expect(shadow.querySelectorAll("article")).toHaveLength(1);
    expect(first[0]?.childElementCount).toBe(0);
    const shown = el(shadow, "article");
    expect(() => mounted.update(json('{"request":"x"}') as Submission)).toThrow(DataError);
    const bad = submission({ parts: [part({ value: json('{"cardinality":"single"}') as SubmissionValue })] });
    expect(() => mounted.update(bad)).toThrow(/^A wire value is invalid: missing the property "baseType"/);
    expect(el(shadow, "article")).toBe(shown);
    expect(answer(shadow)).toBe("Another answer");
    expect(contents(shadow)[0]?.textContent).toContain("Write about your town.");
  });

  it("takes the display and its content roots down when destroyed", () => {
    const { shadow, mounted } = show(submission());
    const roots = contents(shadow);
    mounted.destroy();
    expect(shadow.childElementCount).toBe(0);
    expect(roots[0]?.childElementCount).toBe(0);
  });

  it("speaks the language of the interface that the host gives, and uses its messages", () => {
    const { shadow } = show(submission(), { language: "id", messages: { id: ID_MESSAGES } });
    expect(el(shadow, "article").getAttribute("lang")).toBe("id");
    expect(el(shadow, "h2").textContent).toBe(ID_MESSAGES.submissionTitle);
    expect(fact(shadow, ID_MESSAGES.submissionScorer)).toBe(ID_MESSAGES.submissionHuman);
    const custom = show(submission(), {
      language: "id",
      messages: { id: { ...ID_MESSAGES, submissionTitle: "Work to score" } },
    });
    expect(el(custom.shadow, "h2").textContent).toBe("Work to score");
    expect(el(show(submission()).shadow, "article").getAttribute("lang")).toBe("en");
  });

  it("rejects a host that is not an element or has a shadow root, and leaves a host as it was when the submission is wrong", () => {
    const options = { assets: (path: string) => path, stylesheet: stylesheet(PLAYER_CSS) };
    expect(() => mountSubmission(json("null") as HTMLElement, submission(), options)).toThrow(
      new DataError("The host must be an element, found null."),
    );
    const taken = document.createElement("div");
    taken.attachShadow({ mode: "open" });
    expect(() => mountSubmission(taken, submission(), options)).toThrow(new DataError(HOST_SHADOW_RULE));
    const host = document.createElement("div");
    const shown = mountSubmission(host, submission(), options);
    expect(() => mountSubmission(host, submission(), options)).toThrow(new DataError(HOST_SHADOW_RULE));
    shown.destroy();
    const again = mountSubmission(host, submission(), options);
    expect(host.shadowRoot?.childNodes.length).toBeGreaterThan(0);
    again.destroy();
    const free = document.createElement("div");
    expect(() => mountSubmission(free, json("{}") as Submission, options)).toThrow(DataError);
    expect(free.shadowRoot).toBeNull();
    expect(() => mountSubmission(free, submission(), options)).not.toThrow();
  });

  it("rejects options of other types", () => {
    const base = { assets: (path: string) => path, stylesheet: stylesheet(PLAYER_CSS) };
    const cases: readonly (readonly [unknown, string | RegExp])[] = [
      [null, "The options must be an object, found null."],
      [{ ...base, speed: 1 }, /^The options has the properties .*, found "speed"\.$/],
      [{ ...base, assets: "x" }, /^The option assets must be a function/],
      [{ ...base, stylesheet: {} }, "The option stylesheet must be a CSSStyleSheet, found an object."],
      [{ ...base, language: 5 }, "The option language must be a string, found 5."],
      [{ ...base, messages: [] }, "The option messages must be an object, found an array."],
      [{ ...base, files: { url: 1 } }, "The url of the option files must be a function, found 1."],
      [{ ...base, files: null }, "The option files must be an object with a function url, found null."],
      [{ ...base, itemPath: "x" }, 'The option itemPath must be a function, found "x".'],
      [{ ...base, mathjax: 5 }, "The option mathjax must be a string, found 5."],
      [{ ...base, origins: "x" }, /^The option origins must be an array/],
      [{ ...base, interactions: {} }, /^The option interactions must be a Map/],
    ];
    for (const [options, message] of cases) {
      const host = document.createElement("div");
      expect(() => mountSubmission(host, submission(), options as SubmissionOptions), String(message)).toThrow(
        typeof message === "string" ? new DataError(message) : message,
      );
      expect(host.shadowRoot).toBeNull();
    }
    expect(() =>
      mountSubmission(document.createElement("div"), submission(), { ...base, itemPath: () => json("5") as string }),
    ).toThrow(new DataError("The path that itemPath returned must be a string, found 5."));
  });
});

describe("accessibility", () => {
  /** A submission with every kind of content the display has. */
  function full(): Submission {
    const unseen: ItemKey = { ref: "essay", instance: 2 };
    return submission({
      mode: "externalMachine",
      lti: true,
      variableIdentifierRef: "http://example.org/ref",
      supplied: { value: wire(buildSingle("float", 6)), at: Date.UTC(2026, 9, 30, 12, 1, 0), scorer: "human" },
      rubric: itemBody("<p>Rate the content once.</p>"),
      parts: [
        part({ label: "Task 1: essay" }),
        part({ responseIdentifier: "LIST", value: wire(buildContainer("ordered", "identifier", ["A", "B"])) }),
        part({ responseIdentifier: "FIELDS", value: wire(buildRecord([["a", buildSingle("integer", 1)]])) }),
        part({ responseIdentifier: "NONE", value: null }),
        part({ item: unseen, presented: false, value: null }),
      ],
      items: [
        item({ correctResponses: [{ identifier: "RESPONSE", value: wire(buildSingle("identifier", "B")) }] }),
        item({ key: unseen, title: "Not shown", presented: false, body: [], templateValues: [], correctResponses: [] }),
      ],
    });
  }

  const Themes: readonly Readonly<Record<string, string>>[] = [
    {},
    { "data-ak-polarity": "inverted" },
    { "data-ak-contrast": "high" },
    { "data-ak-contrast": "high", "data-ak-polarity": "inverted" },
  ];

  it("passes axe at WCAG 2.2 A and AA, with a name and a heading for every part", async () => {
    const { host } = show(full(), { files: { url: () => `${ITEM_DIRECTORY}images/dot.png` } });
    expect(await axeViolations(host)).toEqual([]);
  });

  it("keeps the contrast of the display, and of the content in it, in every theme", async () => {
    for (const theme of Themes) {
      const { host, shadow } = show(full(), {}, theme);
      expect(await axeViolations(host), JSON.stringify(theme)).toEqual([]);
      // The content roots take the theme from the display and not the light theme of their own host.
      const contentHost = el(shadow, ".ak-submission-content");
      expect(computed(contentHost, "color")).toBe(computed(host, "color"));
      expect(computed(contentHost, "background-color")).toBe(computed(host, "background-color"));
      host.remove();
    }
  });
});
