import { type RubricRating, type ScoringRubric, scoreFromRatings } from "@assesskit/runtime/asi";
import { DataError } from "@assesskit/runtime/errors";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { ID_MESSAGES } from "../src/messages/id/index.js";
import { mountRatingForm, type RatingFormOptions } from "../src/player/index.js";
import { HOST_SHADOW_RULE } from "../src/player/internal.js";
import { PLAYER_CSS, stylesheet } from "./css-fixture.js";
import { axeViolations } from "./renderer-fixture.js";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

/** Parses JSON text, so that a test passes input as JavaScript or JSON delivers it. */
const json = (text: string): unknown => JSON.parse(text);

/** The example of the guide: an analytic rubric of an essay, in English, whose scores add up to 5 at most. */
const ESSAY: ScoringRubric = {
  outcomeIdentifier: "SCORE",
  kind: "analytic",
  language: "en",
  criteria: [
    {
      identifier: "content",
      weight: 2,
      description: "Content: the response addresses the task.",
      levels: [
        { score: 0, quality: "Absent", description: "No idea relates to the task." },
        { score: 1, quality: "Partial", description: "Some ideas relate to the task." },
        { score: 2, quality: "Full", description: "Every idea addresses the task." },
      ],
    },
    {
      identifier: "language",
      weight: 1,
      description: "Language: grammar and vocabulary.",
      levels: [
        { score: 0, quality: "Weak", description: "Errors block meaning." },
        { score: 1, quality: "Adequate", description: "Errors do not block meaning." },
      ],
    },
  ],
};

const HOLISTIC: ScoringRubric = {
  outcomeIdentifier: "SCORE",
  kind: "holistic",
  criteria: [
    {
      identifier: "overall",
      weight: 1,
      description: "Overall quality.",
      levels: [0, 1, 2, 3].map((score) => ({ score, quality: `Band ${score}` })),
    },
  ],
};

/** A checklist whose second criterion lists its level of 0 second. */
const CHECKLIST: ScoringRubric = {
  outcomeIdentifier: "SCORE",
  kind: "checklist",
  criteria: [
    { identifier: "title", weight: 1, description: "Has a title.", levels: [{ score: 0 }, { score: 1 }] },
    { identifier: "date", weight: 1, description: "Has a date.", levels: [{ score: 1 }, { score: 0 }] },
  ],
};

const SINGLE_POINT: ScoringRubric = {
  outcomeIdentifier: "SCORE",
  kind: "single-point",
  criteria: [
    {
      identifier: "clarity",
      weight: 1,
      description: "The writing is clear.",
      levels: [
        { score: 0, quality: "Below", description: "Unclear." },
        { score: 1, quality: "Meets", description: "Clear." },
        { score: 2, quality: "Above", description: "Very clear." },
      ],
    },
  ],
};

const KINDS: readonly ScoringRubric[] = [ESSAY, HOLISTIC, CHECKLIST, SINGLE_POINT];

/** A criterion that counts for half, and a holistic rubric whose scores are not whole numbers. */
const HALF: ScoringRubric = {
  ...HOLISTIC,
  kind: "analytic",
  criteria: [
    { identifier: "half", weight: 0.5, description: "Counts for half.", levels: [{ score: 0 }, { score: 1 }] },
  ],
};
const FRACTIONS: ScoringRubric = {
  ...HOLISTIC,
  criteria: [{ identifier: "overall", weight: 1, levels: [{ score: 0.5 }, { score: 1.5 }] }],
};

/** Mounts a form in a host that the page holds, with the options of the tests. */
function show(rubric: ScoringRubric, extra: Partial<RatingFormOptions> = {}, attributes: Record<string, string> = {}) {
  const host = document.createElement("div");
  for (const [name, value] of Object.entries(attributes)) host.setAttribute(name, value);
  document.body.append(host);
  hosts.push(host);
  const mounted = mountRatingForm(host, rubric, { stylesheet: stylesheet(PLAYER_CSS), ...extra });
  const shadow = host.shadowRoot;
  if (shadow === null) throw new Error("The form has no shadow root.");
  return { host, shadow, mounted };
}

/** Returns the elements below a root that match a selector. */
const all = <T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] => [
  ...root.querySelectorAll<T>(selector),
];

/** Returns the element that matches, which must exist. */
function el<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`No element matches ${selector}.`);
  return found;
}

/** Returns the radio buttons of the criterion at an index. */
const radios = (root: ParentNode, criterion: number): HTMLInputElement[] =>
  all<HTMLInputElement>(all(root, "fieldset")[criterion] ?? root, "input[type=radio]");

const status = (root: ParentNode): string => el(root, "output").textContent;

/** Chooses the level at an index of the criterion at an index, as a pointer does. */
async function choose(root: ParentNode, criterion: number, level: number): Promise<void> {
  const input = radios(root, criterion)[level];
  if (input === undefined) throw new Error(`No level ${level} in criterion ${criterion}.`);
  await userEvent.click(input.closest("label") ?? input);
}

describe("the form of each kind", () => {
  it("shows a group of radio buttons for each criterion, named by its description, with a label for each level", () => {
    const { shadow } = show(ESSAY);
    const groups = all(shadow, "fieldset");
    expect(groups.map((group) => group.getAttribute("role"))).toEqual(["radiogroup", "radiogroup"]);
    expect(groups.map((group) => el(group, "legend").textContent)).toEqual([
      "Content: the response addresses the task. Weight 2",
      "Language: grammar and vocabulary.",
    ]);
    expect(radios(shadow, 0).map((input) => input.labels?.[0]?.textContent)).toEqual([
      "Absent Points 0 No idea relates to the task.",
      "Partial Points 1 Some ideas relate to the task.",
      "Full Points 2 Every idea addresses the task.",
    ]);
    expect(radios(shadow, 1)).toHaveLength(2);
    expect(all(shadow, "input:checked")).toEqual([]);
  });

  it("shows one group for a holistic rubric and three radio buttons for each criterion of a single-point rubric", () => {
    expect(all(show(HOLISTIC).shadow, "fieldset")).toHaveLength(1);
    expect(radios(show(HOLISTIC).shadow, 0)).toHaveLength(4);
    const { shadow } = show(SINGLE_POINT);
    expect(radios(shadow, 0).map((input) => input.labels?.[0]?.textContent)).toEqual([
      "Below Points 0 Unclear.",
      "Meets Points 1 Clear.",
      "Above Points 2 Very clear.",
    ]);
  });

  it("asks a checklist for met or not met, in the order of the levels, with nothing chosen at first", () => {
    const { shadow, mounted } = show(CHECKLIST);
    expect(radios(shadow, 0).map((input) => input.labels?.[0]?.textContent)).toEqual([
      "Not met Points 0",
      "Met Points 1",
    ]);
    expect(radios(shadow, 1).map((input) => input.labels?.[0]?.textContent)).toEqual([
      "Met Points 1",
      "Not met Points 0",
    ]);
    expect(all(shadow, "input:checked")).toEqual([]);
    expect(mounted.score).toBeNull();
    expect(mounted.reportValidity()).toBe(false);
  });

  it("shows the weight of a criterion only when it is not 1, written for the language of the interface", () => {
    const { shadow } = show(HALF, { language: "id", messages: { id: ID_MESSAGES } });
    expect(all(shadow, ".ak-rating-weight").map((node) => node.textContent)).toEqual(["Bobot 0,5"]);
    expect(all(show(HOLISTIC).shadow, ".ak-rating-weight")).toEqual([]);
  });
});

describe("the ratings and the score", () => {
  it("tells that the score is not rated until every criterion is, and then the score out of the highest", async () => {
    const { shadow, mounted } = show(ESSAY);
    expect(status(shadow)).toBe("Score not rated");
    await choose(shadow, 0, 2);
    expect(status(shadow)).toBe("Score not rated");
    expect(mounted.score).toBeNull();
    await choose(shadow, 1, 1);
    expect(status(shadow)).toBe("Score 5 out of 5");
    expect(mounted.score).toBe(5);
    await choose(shadow, 0, 1);
    expect(status(shadow)).toBe("Score 3 out of 5");
  });

  it("gives the ratings in the order of the criteria with the score of the runtime", async () => {
    const { shadow, mounted } = show(ESSAY);
    await choose(shadow, 1, 0);
    await choose(shadow, 0, 1);
    const ratings: RubricRating[] = [
      { criterion: "content", score: 1 },
      { criterion: "language", score: 0 },
    ];
    expect(mounted.ratings).toEqual(ratings);
    expect(mounted.score).toBe(scoreFromRatings(ESSAY, ratings));
    expect(mounted.ratings).not.toBe(mounted.ratings);
  });

  it("calls onChange with the ratings and the score after each change by the rater, and for nothing else", async () => {
    const calls: [readonly RubricRating[], number | null][] = [];
    const { shadow, mounted } = show(ESSAY, {
      ratings: [{ criterion: "content", score: 2 }],
      onChange: (ratings, score) => {
        calls.push([ratings, score]);
      },
    });
    expect(calls).toEqual([]);
    await choose(shadow, 1, 1);
    expect(calls).toEqual([
      [
        [
          { criterion: "content", score: 2 },
          { criterion: "language", score: 1 },
        ],
        5,
      ],
    ]);
    mounted.update(HOLISTIC);
    expect(calls).toHaveLength(1);
  });

  it("shows the ratings it is given at first, those of an earlier rater", () => {
    const { shadow, mounted } = show(ESSAY, {
      ratings: [
        { criterion: "language", score: 0 },
        { criterion: "content", score: 2 },
      ],
    });
    expect(all<HTMLInputElement>(shadow, "input:checked").map((input) => input.labels?.[0]?.textContent)).toEqual([
      "Full Points 2 Every idea addresses the task.",
      "Weak Points 0 Errors block meaning.",
    ]);
    expect(status(shadow)).toBe("Score 4 out of 5");
    expect(mounted.score).toBe(4);
  });

  it("is operated by keyboard: the arrow keys choose within a group", async () => {
    const { shadow, mounted } = show(ESSAY);
    const [first] = radios(shadow, 0);
    if (first === undefined) throw new Error("The first criterion has choices.");
    await userEvent.type(first, "{ArrowDown}{ArrowDown}");
    expect(radios(shadow, 0).map((input) => input.checked)).toEqual([false, false, true]);
    expect(mounted.ratings).toEqual([{ criterion: "content", score: 2 }]);
    const [other] = radios(shadow, 1);
    if (other === undefined) throw new Error("The second criterion has choices.");
    await userEvent.type(other, "{ArrowDown}");
    expect(mounted.ratings).toEqual([
      { criterion: "content", score: 2 },
      { criterion: "language", score: 1 },
    ]);
  });
});

describe("checking the form", () => {
  it("marks each criterion without a rating, links the message, and puts the focus on the first", () => {
    const { shadow, mounted } = show(ESSAY);
    expect(mounted.reportValidity()).toBe(false);
    const groups = all(shadow, "fieldset");
    for (const group of groups) {
      expect(group.getAttribute("aria-invalid")).toBe("true");
      const message = el(shadow, `#${group.getAttribute("aria-describedby")}`);
      expect(message.textContent).toBe("Choose a level for this criterion.");
      expect(group.contains(message)).toBe(true);
    }
    expect(shadow.activeElement).toBe(radios(shadow, 0)[0]);
    expect(mounted.reportValidity()).toBe(false);
    expect(all(shadow, ".ak-rating-error")).toHaveLength(2);
  });

  it("takes the mark off a criterion when it is rated, and reports true when every criterion is", async () => {
    const { shadow, mounted } = show(ESSAY);
    mounted.reportValidity();
    await choose(shadow, 1, 0);
    const [content, language] = all(shadow, "fieldset");
    expect(language?.hasAttribute("aria-invalid")).toBe(false);
    expect(language?.hasAttribute("aria-describedby")).toBe(false);
    expect(content?.getAttribute("aria-invalid")).toBe("true");
    await choose(shadow, 0, 0);
    expect(all(shadow, ".ak-rating-error")).toEqual([]);
    expect(mounted.reportValidity()).toBe(true);
  });

  it("is incomplete when a checklist is untouched, so that nothing is met or not met by accident", () => {
    const { mounted } = show(CHECKLIST);
    expect(mounted.score).toBeNull();
    expect(mounted.ratings).toEqual([]);
    expect(mounted.reportValidity()).toBe(false);
  });
});

describe("the read-only form", () => {
  it("shows the level chosen for each criterion as text, or that there is none, and then the score", () => {
    const { shadow, mounted } = show(ESSAY, { readOnly: true, ratings: [{ criterion: "content", score: 1 }] });
    expect(all(shadow, "input, button, fieldset")).toEqual([]);
    const entries = all(shadow, ".ak-rating-criterion");
    expect(entries.map((entry) => entry.textContent)).toEqual([
      "Content: the response addresses the task. Weight 2Partial Points 1 Some ideas relate to the task.",
      "Language: grammar and vocabulary.not rated",
    ]);
    expect(status(shadow)).toBe("Score not rated");
    expect(mounted.score).toBeNull();
    expect(mounted.ratings).toEqual([{ criterion: "content", score: 1 }]);
  });

  it("gives the score of complete ratings, and reportValidity moves no focus and marks nothing", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    hosts.push(outside);
    const { shadow, mounted } = show(ESSAY, { readOnly: true });
    outside.focus();
    expect(mounted.reportValidity()).toBe(false);
    expect(document.activeElement).toBe(outside);
    expect(all(shadow, "[aria-invalid], .ak-rating-error")).toEqual([]);
    mounted.update(ESSAY, [
      { criterion: "content", score: 2 },
      { criterion: "language", score: 1 },
    ]);
    expect(status(shadow)).toBe("Score 5 out of 5");
    expect(mounted.reportValidity()).toBe(true);
  });

  it("shows a checklist as met and not met", () => {
    const { shadow } = show(CHECKLIST, {
      readOnly: true,
      ratings: [
        { criterion: "title", score: 1 },
        { criterion: "date", score: 0 },
      ],
    });
    expect(all(shadow, "dd").map((node) => node.textContent)).toEqual(["Met Points 1", "Not met Points 0"]);
    expect(status(shadow)).toBe("Score 1 out of 2");
  });
});

describe("showing another rubric", () => {
  it("shows the rubric and ratings it is given in the same place, and drops the old ratings", async () => {
    const { shadow, mounted } = show(ESSAY);
    await choose(shadow, 0, 1);
    mounted.update(HOLISTIC, [{ criterion: "overall", score: 3 }]);
    expect(all(shadow, "fieldset")).toHaveLength(1);
    expect(mounted.ratings).toEqual([{ criterion: "overall", score: 3 }]);
    expect(status(shadow)).toBe("Score 3 out of 3");
    mounted.update(ESSAY);
    expect(mounted.ratings).toEqual([]);
    expect(all(shadow, "input:checked")).toEqual([]);
  });

  it("listens to the form it shows and to no other", async () => {
    const calls: number[] = [];
    const { shadow, mounted } = show(ESSAY, { onChange: (_, score) => void calls.push(score ?? -1) });
    const old = radios(shadow, 0)[0];
    mounted.update(ESSAY);
    old?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(calls).toEqual([]);
    await choose(shadow, 0, 0);
    expect(calls).toEqual([-1]);
  });

  it("leaves the form as it was when the rubric or a rating is refused", async () => {
    const { shadow, mounted } = show(ESSAY);
    await choose(shadow, 0, 1);
    const before = shadow.innerHTML;
    expect(() => mounted.update(json('{"outcomeIdentifier":"S"}') as ScoringRubric)).toThrow(DataError);
    expect(() => mounted.update(HOLISTIC, [{ criterion: "nope", score: 1 }])).toThrow(DataError);
    expect(() => mounted.update(HOLISTIC, [{ criterion: "overall", score: 9 }])).toThrow(DataError);
    expect(shadow.innerHTML).toBe(before);
    await choose(shadow, 1, 1);
    expect(mounted.score).toBe(3);
  });
});

describe("the languages", () => {
  it("marks the language of the interface on the form and the language of the rubric on each text of it", () => {
    const { shadow } = show(ESSAY, { language: "id", messages: { id: ID_MESSAGES } }, {});
    expect(el(shadow, "form").getAttribute("lang")).toBe("id");
    const texts = all(shadow, '[dir="auto"]');
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text.getAttribute("lang"), text.textContent).toBe("en");
    for (const own of all(shadow, ".ak-rating-points, .ak-rating-weight, output")) {
      expect(own.hasAttribute("lang"), own.textContent).toBe(false);
      expect(own.closest("[lang]")?.getAttribute("lang")).toBe("id");
    }
    expect(status(shadow)).toBe("Skor belum dinilai");
    expect(el(shadow, "form").getAttribute("aria-label")).toBe("Penilaian");
  });

  it("leaves the language of a text to the interface when the rubric gives none, and writes numbers for the interface", async () => {
    const { shadow } = show(FRACTIONS, { language: "id", messages: { id: ID_MESSAGES } });
    expect(all(shadow, "[lang]:not(form):not(output)")).toEqual([]);
    await choose(shadow, 0, 1);
    expect(status(shadow)).toBe("Skor 1,5 dari maksimum 1,5");
  });

  it("takes the messages that a host gives, for the language of the interface", () => {
    const { shadow } = show(ESSAY, { language: "id", messages: { id: { ...ID_MESSAGES, ratingScore: "Nilai" } } });
    expect(status(shadow)).toBe("Nilai belum dinilai");
  });
});

describe("text", () => {
  it("shows the texts of a rubric as plain text, never as markup", () => {
    const hostile: ScoringRubric = {
      ...HOLISTIC,
      criteria: [
        {
          identifier: "overall",
          weight: 1,
          description: "<img src=x onerror=alert(1)>",
          levels: [{ score: 0, quality: "<b>bold</b>" }, { score: 1 }],
        },
      ],
    };
    const { shadow } = show(hostile);
    expect(all(shadow, "img, b")).toEqual([]);
    expect(el(shadow, "legend").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(radios(shadow, 0)[0]?.labels?.[0]?.textContent).toBe("<b>bold</b> Points 0");
  });

  it("names a criterion without a description by its identifier", () => {
    const bare: ScoringRubric = {
      ...HOLISTIC,
      criteria: [{ identifier: "overall", weight: 1, levels: [{ score: 0 }, { score: 1 }] }],
    };
    expect(el(show(bare).shadow, "legend").textContent).toBe("overall");
  });
});

describe("accessibility", () => {
  it("meets WCAG 2.2 AA for each kind, empty, rated, checked and read-only", async () => {
    for (const rubric of KINDS) {
      const ratings = rubric.criteria.map(({ identifier, levels }) => ({
        criterion: identifier,
        score: Math.max(...levels.map(({ score }) => score)),
      }));
      const empty = show(rubric);
      expect(await axeViolations(empty.host), `${rubric.kind} empty`).toEqual([]);
      empty.mounted.reportValidity();
      expect(await axeViolations(empty.host), `${rubric.kind} checked`).toEqual([]);
      const rated = show(rubric, { ratings });
      expect(await axeViolations(rated.host), `${rubric.kind} rated`).toEqual([]);
      expect(rated.mounted.score).not.toBeNull();
      const readOnly = show(rubric, { ratings, readOnly: true });
      expect(await axeViolations(readOnly.host), `${rubric.kind} read-only`).toEqual([]);
    }
  });

  it("gives every control a target of at least 24 by 24 CSS pixels", () => {
    const { shadow } = show(ESSAY);
    for (const input of all<HTMLInputElement>(shadow, "input")) {
      const { width, height } = input.getBoundingClientRect();
      expect([width >= 24, height >= 24]).toEqual([true, true]);
    }
    for (const label of all(shadow, "label")) {
      expect(label.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    }
  });

  it("has no horizontal scroll at a width of 320 CSS pixels", () => {
    const { host } = show(ESSAY);
    host.style.inlineSize = "320px";
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  });

  it("announces the score in a status region", () => {
    const { shadow } = show(ESSAY);
    expect(el(shadow, "output").getAttribute("role")).toBe("status");
  });
});

describe("mounting and taking down", () => {
  it("removes the form and its listeners when it is destroyed, and leaves the shadow root empty", async () => {
    const calls: number[] = [];
    const { shadow, mounted } = show(ESSAY, { onChange: () => void calls.push(1) });
    const input = radios(shadow, 0)[0];
    mounted.destroy();
    expect(shadow.childNodes).toHaveLength(0);
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(calls).toEqual([]);
  });

  it("refuses a host that is not an element or has a shadow root, and leaves nothing behind", () => {
    const options = { stylesheet: stylesheet(PLAYER_CSS) };
    expect(() => mountRatingForm(json("null") as HTMLElement, ESSAY, options)).toThrow(
      new DataError("The host must be an element, found null."),
    );
    const taken = document.createElement("div");
    taken.attachShadow({ mode: "open" });
    expect(() => mountRatingForm(taken, ESSAY, options)).toThrow(new DataError(HOST_SHADOW_RULE));
    const host = document.createElement("div");
    const shown = mountRatingForm(host, ESSAY, options);
    expect(() => mountRatingForm(host, ESSAY, options)).toThrow(new DataError(HOST_SHADOW_RULE));
    shown.destroy();
    const again = mountRatingForm(host, ESSAY, options);
    expect(host.shadowRoot?.childNodes.length).toBeGreaterThan(0);
    again.destroy();
    const bad = document.createElement("div");
    expect(() => mountRatingForm(bad, json('{"outcomeIdentifier":1}') as ScoringRubric, options)).toThrow(DataError);
    expect(bad.shadowRoot).toBeNull();
  });

  it("refuses options and ratings of another type, as JSON passes them", () => {
    const host = () => document.createElement("div");
    const mount = (options: unknown, rubric: ScoringRubric = ESSAY) =>
      mountRatingForm(host(), rubric, options as RatingFormOptions);
    const sheet = stylesheet(PLAYER_CSS);
    expect(() => mount(json("null"))).toThrow(new DataError("The options must be an object, found null."));
    expect(() => mount({ ...(json('{"extra":1}') as object), stylesheet: sheet })).toThrow(DataError);
    expect(() => mount({ stylesheet: json("1") })).toThrow(DataError);
    expect(() => mount({ stylesheet: sheet, language: json("1") })).toThrow(DataError);
    expect(() => mount({ stylesheet: sheet, messages: json("null") })).toThrow(DataError);
    expect(() => mount({ stylesheet: sheet, ratings: json("{}") })).toThrow(DataError);
    expect(() => mount({ stylesheet: sheet, readOnly: json('"yes"') })).toThrow(DataError);
    expect(() => mount({ stylesheet: sheet, onChange: json("1") })).toThrow(DataError);
    expect(() => mount({ stylesheet: sheet, ratings: [{ criterion: "nope", score: 1 }] })).toThrow(DataError);
    expect(() => mount({ stylesheet: sheet, ratings: [{ criterion: "content", score: 7 }] })).toThrow(DataError);
    expect(() => mount({ stylesheet: sheet }, json("null") as ScoringRubric)).toThrow(DataError);
  });
});
