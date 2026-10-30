import type { CandidateView, RefusalCode } from "@luthfanwakan/olah/delivery";
import type { AssessmentResult } from "@luthfanwakan/olah/results";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isRecord } from "../src/checks.js";
import { DataError } from "../src/index.js";
import {
  checkActionEnvelope,
  checkAllowList,
  checkCaller,
  checkLtiFrame,
  checkRefusal,
  checkSubmission,
  checkViewEnvelope,
  isOfficialResult,
  LTI_STORAGE_FRAME,
  LTI_TOOL_FRAME,
  REFUSAL_CODES,
  viewDocuments,
} from "../src/protocol/index.js";
import { markOfficial } from "../src/protocol/official.js";

/** Parses JSON text, so that a test passes input as JavaScript or JSON delivers it. */
const json = (text: string): unknown => JSON.parse(text);

const action = { type: "move", direction: "next" };
const view = { status: "interacting" };

describe("checkCaller", () => {
  it("accepts an object with a session and a principal", () => {
    expect(() => checkCaller({ session: "s1", principal: "p1" })).not.toThrow();
  });

  it("accepts further properties, which the host's authentication may add", () => {
    expect(() => checkCaller(json('{"session":"s1","principal":"p1","role":"candidate"}'))).not.toThrow();
  });

  it("rejects what is not an object", () => {
    for (const text of ["null", "[]", '"s1"', "5"]) {
      expect(() => checkCaller(json(text)), text).toThrow(/^The caller must be an object, found /);
    }
  });

  it("rejects a session or a principal that is missing, empty or not a string", () => {
    expect(() => checkCaller(json('{"principal":"p1"}'))).toThrow(
      new DataError("The session of a caller must be a non-empty string, found undefined."),
    );
    expect(() => checkCaller(json('{"session":"","principal":"p1"}'))).toThrow(
      new DataError('The session of a caller must be a non-empty string, found "".'),
    );
    expect(() => checkCaller(json('{"session":"s1"}'))).toThrow(
      new DataError("The principal of a caller must be a non-empty string, found undefined."),
    );
    expect(() => checkCaller(json('{"session":"s1","principal":7}'))).toThrow(
      new DataError("The principal of a caller must be a non-empty string, found 7."),
    );
  });
});

describe("checkActionEnvelope", () => {
  it("accepts an envelope with a sequence number and an action", () => {
    const envelope: unknown = json(JSON.stringify({ seq: 3, action }));
    expect(() => checkActionEnvelope(envelope)).not.toThrow();
  });

  it("accepts any action, which olah's parser reads", () => {
    for (const text of ["null", "5", '"move"', "[]", "{}"]) {
      expect(() => checkActionEnvelope(json(`{"seq":0,"action":${text}}`)), text).not.toThrow();
    }
  });

  it("rejects what is not an object", () => {
    for (const text of ["null", "[]", '"seq"', "5"]) {
      expect(() => checkActionEnvelope(json(text)), text).toThrow(/^An action envelope must be an object, found /);
    }
  });

  it("rejects a session identifier, which an envelope never carries", () => {
    expect(() => checkActionEnvelope(json('{"seq":1,"action":{},"session":"s2"}'))).toThrow(
      new DataError('An action envelope has the properties "seq" and "action", found "session".'),
    );
  });

  it("rejects a sequence number that is not a non-negative integer", () => {
    for (const text of ['"1"', "-1", "1.5", "null", "1e300"]) {
      expect(() => checkActionEnvelope(json(`{"seq":${text},"action":{}}`)), text).toThrow(
        /^The property seq of an action envelope must be a non-negative integer, found /,
      );
    }
    expect(() => checkActionEnvelope(json('{"action":{}}'))).toThrow("found undefined.");
  });

  it("rejects an envelope without an action", () => {
    expect(() => checkActionEnvelope(json('{"seq":1}'))).toThrow(
      new DataError('An action envelope must have the property "action".'),
    );
  });
});

describe("checkViewEnvelope", () => {
  const assets = { "items/q1/": "https://assets.example/g/token/" };

  it("accepts an envelope with a sequence number, a view and the asset prefixes", () => {
    const envelope: unknown = json(JSON.stringify({ seq: 4, view, assets }));
    expect(() => checkViewEnvelope(envelope)).not.toThrow();
  });

  it("accepts an envelope without asset prefixes", () => {
    expect(() => checkViewEnvelope(json('{"seq":0,"view":{},"assets":{}}'))).not.toThrow();
  });

  it("rejects what is not an object", () => {
    for (const text of ["null", "[]", '"view"', "5"]) {
      expect(() => checkViewEnvelope(json(text)), text).toThrow(/^A view envelope must be an object, found /);
    }
  });

  it("rejects a property that an envelope does not have", () => {
    expect(() => checkViewEnvelope(json('{"seq":1,"view":{},"assets":{},"principal":"p1"}'))).toThrow(
      new DataError(
        'A view envelope has the properties "seq", "view", "assets", "documents" and "refusal", found "principal".',
      ),
    );
  });

  it("rejects a sequence number that is not a non-negative integer", () => {
    expect(() => checkViewEnvelope(json('{"seq":-2,"view":{},"assets":{}}'))).toThrow(
      new DataError("The property seq of a view envelope must be a non-negative integer, found -2."),
    );
  });

  it("rejects an envelope without a view", () => {
    expect(() => checkViewEnvelope(json('{"seq":1,"assets":{}}'))).toThrow(
      new DataError('A view envelope must have the property "view".'),
    );
  });

  it("rejects assets that are not an object of strings", () => {
    expect(() => checkViewEnvelope(json('{"seq":1,"view":{}}'))).toThrow(
      new DataError("The property assets of a view envelope must be an object, found undefined."),
    );
    expect(() => checkViewEnvelope(json('{"seq":1,"view":{},"assets":["a/"]}'))).toThrow("found an array.");
    expect(() => checkViewEnvelope(json('{"seq":1,"view":{},"assets":{"items/q1/":5}}'))).toThrow(
      new DataError('The base URL of the asset prefix "items/q1/" must be a string, found 5.'),
    );
  });
});

describe("checkViewEnvelope: documents and refusal", () => {
  const base = { seq: 2, view: {}, assets: {} };

  it("[T71] accepts the documents of a view and the refusal of an action", () => {
    const documents = { test: "tests/exam.xml", item: "items/q1/item.xml", stimuli: ["stimuli/s1.xml"] };
    const refusal = { code: "time-over", message: "The time is over.", source: "INFO §2.8.5" };
    expect(() => checkViewEnvelope(json(JSON.stringify({ ...base, documents, refusal })))).not.toThrow();
  });

  it("[T71] rejects documents that are not an object of the test, the item and the stimuli", () => {
    const check = (documents: string): void =>
      checkViewEnvelope(json(`{"seq":2,"view":{},"assets":{},"documents":${documents}}`));
    expect(() => check("[]")).toThrow("The documents of a view envelope must be an object, found an array.");
    expect(() => check('{"test":"","item":""}')).toThrow(
      "The property stimuli of the documents of a view envelope must be an array",
    );
    expect(() => check('{"test":1,"item":"","stimuli":[]}')).toThrow(
      "The property test of the documents of a view envelope must be a string",
    );
    expect(() => check('{"test":"","item":"","stimuli":[5]}')).toThrow("A path of the stimuli");
    expect(() => check('{"test":"","item":"","stimuli":[],"other":1}')).toThrow(
      "The documents of a view envelope has the properties",
    );
  });

  it("[T71] rejects a refusal that is not one of olah's", () => {
    const check = (refusal: string): void =>
      checkViewEnvelope(json(`{"seq":2,"view":{},"assets":{},"refusal":${refusal}}`));
    expect(() => check("5")).toThrow("A refusal must be an object, found 5.");
    expect(() => check('{"code":"nope","message":"m","source":"s"}')).toThrow(
      'The property code of a refusal must be "attempts-exhausted"',
    );
    expect(() => check('{"code":"ended","message":1,"source":"s"}')).toThrow(
      "The property message of a refusal must be a string",
    );
    expect(() => check('{"code":"ended","message":"m"}')).toThrow(
      "The property source of a refusal must be a string, found undefined.",
    );
    expect(() => check('{"code":"ended","message":"m","source":"s","at":1}')).toThrow("A refusal has the properties");
  });
});

describe("REFUSAL_CODES", () => {
  it("[T55] lists every refusal code of olah", () => {
    const every: Readonly<Record<RefusalCode, true>> = {
      "attempts-exhausted": true,
      "awaiting-cat": true,
      "clock-regression": true,
      "comment-not-allowed": true,
      ended: true,
      "invalid-response": true,
      "item-closed": true,
      "linear-backward": true,
      "min-time-not-reached": true,
      "not-current": true,
      "review-not-allowed": true,
      "score-type-mismatch": true,
      "skipping-not-allowed": true,
      "solution-not-allowed": true,
      "support-not-available": true,
      suspended: true,
      "time-over": true,
      "unknown-item": true,
      "unknown-request": true,
      "value-out-of-range": true,
      "wrong-submission-mode": true,
    };
    expect([...REFUSAL_CODES].sort()).toEqual(Object.keys(every).sort());
    for (const code of REFUSAL_CODES) expect(() => checkRefusal({ code, message: "m", source: "s" })).not.toThrow();
  });
});

describe("viewDocuments", () => {
  const view = (current: unknown): CandidateView =>
    JSON.parse(JSON.stringify({ test: { identifier: "t", title: "T" }, current }));
  const source = {
    test: "tests/t.xml",
    item: (reference: string) =>
      reference === "q1" ? { path: "items/q1.xml", stimuli: ["stimuli/s.xml"] } : undefined,
  };

  it("[T73] names the documents of the item presented and the test", () => {
    expect(viewDocuments(view({ key: { ref: "q1", instance: 1 } }), source)).toEqual({
      test: "tests/t.xml",
      item: "items/q1.xml",
      stimuli: ["stimuli/s.xml"],
    });
  });

  it("[T73] resolves against the root of the package for a variant, an unknown item, no item, and no source", () => {
    const root = { test: "tests/t.xml", item: "", stimuli: [] };
    expect(viewDocuments(view({ key: { ref: "q1", instance: 1 }, variant: { resource: "v" } }), source)).toEqual(root);
    expect(viewDocuments(view({ key: { ref: "q9", instance: 1 } }), source)).toEqual(root);
    expect(viewDocuments(view(undefined), source)).toEqual(root);
    expect(viewDocuments(view({ key: { ref: "q1", instance: 1 } }), undefined)).toEqual({
      test: "",
      item: "",
      stimuli: [],
    });
  });
});

describe("the frame of an LTI item", () => {
  const frame = { url: "https://tool.example.com/lti/login", storageUrl: "https://lti.platform.example/storage" };

  it("[T106] names the frames of the tool and of the storage page, which the storage page and the tool look for by name", () => {
    expect([LTI_TOOL_FRAME, LTI_STORAGE_FRAME]).toEqual(["lti-tool", "lti-storage"]);
  });

  it("[T106] accepts a frame with two URLs, with or without an allow list", () => {
    expect(() => checkLtiFrame(frame)).not.toThrow();
    expect(() =>
      checkLtiFrame({ ...frame, allow: "microphone; camera 'self' https://tool.example.com" }),
    ).not.toThrow();
    expect(() =>
      checkLtiFrame({ url: "http://127.0.0.1:8080/login", storageUrl: "http://127.0.0.1:8081/storage" }),
    ).not.toThrow();
  });

  it("[T106] rejects what is not a frame", () => {
    const cases: readonly [unknown, string][] = [
      [json("null"), "The frame of an LTI item must be an object, found null."],
      [
        { ...frame, extra: 1 },
        'The frame of an LTI item has the properties "url", "storageUrl" and "allow", found "extra".',
      ],
      [
        { storageUrl: frame.storageUrl },
        "The property url of the frame of an LTI item must be a string, found undefined.",
      ],
      [
        { ...frame, url: "javascript:alert(1)" },
        'The property url of the frame of an LTI item must be an absolute http or https URL, found "javascript:alert(1)".',
      ],
      [
        { ...frame, url: "data:text/html,x" },
        'The property url of the frame of an LTI item must be an absolute http or https URL, found "data:text/html,x".',
      ],
      [
        { ...frame, storageUrl: "/storage" },
        'The property storageUrl of the frame of an LTI item must be an absolute http or https URL, found "/storage".',
      ],
      [{ ...frame, allow: json("5") }, "The property allow of the frame of an LTI item must be a string, found 5."],
      [
        { ...frame, allow: "" },
        'The property allow of the frame of an LTI item must be a Permissions Policy allow list of letters, digits, spaces and the characters ; * : / . \' -, found "".',
      ],
    ];
    for (const [value, message] of cases) expect(() => checkLtiFrame(value), message).toThrow(new DataError(message));
  });

  it("[T106] accepts an allow list of the characters of a Permissions Policy and rejects any other", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9 ;*:/.'-]{1,40}$/u), (allow) => {
        expect(() => checkAllowList(allow, "The allow list")).not.toThrow();
      }),
    );
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom('"', ",", "(", ")", "\n", "<", "`"),
        (head, bad) => {
          expect(() => checkAllowList(`${head}${bad}`, "The allow list")).toThrow(DataError);
        },
      ),
    );
  });
});

describe("official results", () => {
  const report = (): AssessmentResult => JSON.parse('{"testResults":[],"itemResults":[]}');

  it("[T67] marks the report that the host brands, and no copy of it", () => {
    const result = report();
    expect(isOfficialResult(result)).toBe(false);
    const official = markOfficial(result);
    expect(official).toBe(result);
    expect(isOfficialResult(official)).toBe(true);
    expect(isOfficialResult({ ...official })).toBe(false);
    expect(isOfficialResult(structuredClone(official))).toBe(false);
    expect(isOfficialResult(JSON.parse(JSON.stringify(official)))).toBe(false);
    expect(isOfficialResult(report())).toBe(false);
  });

  it("[T67] marks nothing that is not an object", () => {
    for (const text of ["null", "5", '"result"', "[]"]) expect(isOfficialResult(json(text)), text).toBe(false);
  });
});

/** A submission as JSON delivers it: a request of an item outcome with one part, one item and a score supplied before. */
const SUBMISSION = {
  request: "item:e:1:SCORE",
  outcome: "SCORE",
  mode: "human",
  declaration: { cardinality: "single", baseType: "float", normalMaximum: 10 },
  requestedAt: 2_000,
  supplied: {
    value: { cardinality: "single", baseType: "float", value: { base: { float: 7.5 } } },
    at: 3_000,
    scorer: "human",
  },
  rubric: [{ kind: "p", children: [{ kind: "text", value: "Rate the content." }] }],
  parts: [
    {
      item: { ref: "e", instance: 1 },
      responseIdentifier: "RESPONSE",
      label: "Essay",
      presented: true,
      interaction: "extended-text-interaction",
      value: { cardinality: "single", baseType: "string", value: { base: { string: "Dear Sir" } } },
    },
  ],
  items: [
    {
      key: { ref: "e", instance: 1 },
      title: "Essay",
      presented: true,
      body: [{ kind: "p", children: [{ kind: "text", value: "Write." }] }],
      templateValues: [{ identifier: "N", value: null }],
      correctResponses: [],
    },
  ],
};

/** A step of a path into JSON: a property or an index. */
type Step = string | number;

/** Returns a copy of JSON with the value at a path replaced; an `undefined` value leaves the property out of the text. */
function set(node: unknown, path: readonly Step[], value: unknown): unknown {
  const [step, ...rest] = path;
  if (step === undefined) return value;
  if (Array.isArray(node)) return node.map((child, index) => (index === step ? set(child, rest, value) : child));
  if (isRecord(node)) return { ...node, [step]: set(node[step], rest, value) };
  throw new Error("The path leaves the submission.");
}

/** Returns the submission with the value at a path replaced, as JSON delivers it. */
const changed = (path: readonly Step[], value: unknown): unknown => json(JSON.stringify(set(SUBMISSION, path, value)));

describe("checkSubmission", () => {
  it("[T110] accepts a submission with every part of its form", () => {
    expect(() => checkSubmission(json(JSON.stringify(SUBMISSION)))).not.toThrow();
  });

  it("[T110] accepts the optional parts left out, a record declaration and NULL values", () => {
    const edits: readonly (readonly [readonly Step[], unknown])[] = [
      [["supplied"], undefined],
      [["declaration"], { cardinality: "record" }],
      [["parts", 0, "label"], undefined],
      [["parts", 0, "interaction"], undefined],
      [["parts", 0, "value"], null],
      [["lti"], true],
      [["variableIdentifierRef"], "ref"],
    ];
    for (const [path, value] of edits)
      expect(() => checkSubmission(changed(path, value)), path.join(".")).not.toThrow();
  });

  it("[T110] rejects what is not an object, and a property that its form lacks", () => {
    for (const text of ["null", "[]", '"s"', "5"]) {
      expect(() => checkSubmission(json(text)), text).toThrow(/^A submission must be an object, found /);
    }
    expect(() => checkSubmission(changed(["session"], "s1"))).toThrow(
      /^A submission has the properties "request", "outcome", .* and "items", found "session"\.$/,
    );
    expect(() => checkSubmission(changed(["items", 0, "secret"], 1))).toThrow(
      /^An item of a submission has the properties .*, found "secret"\.$/,
    );
  });

  it("[T110] rejects a field of another type, and says which", () => {
    const cases: readonly (readonly [readonly Step[], unknown, string | RegExp])[] = [
      [["request"], "", 'The request of a submission must be a non-empty string, found "".'],
      [["outcome"], 5, "The outcome of a submission must be a non-empty string, found 5."],
      [["mode"], "robot", 'The mode of a submission must be "human" or "externalMachine", found "robot".'],
      [["lti"], false, "The lti of a submission must be true or absent, found false."],
      [["variableIdentifierRef"], 1, "The variableIdentifierRef of a submission must be a string, found 1."],
      [["requestedAt"], "now", 'The requestedAt of a submission must be a finite number, found "now".'],
      [
        ["requestedAt"],
        253_402_300_800_000,
        "The requestedAt of a submission must be epoch milliseconds from the year 1 to the year 9999, found 253402300800000.",
      ],
      [["rubric"], {}, "The rubric of a submission must be an array of nodes, found an object."],
      [
        ["rubric"],
        [{ text: "x" }],
        "The rubric of a submission must hold nodes, each an object with a string kind, found an object.",
      ],
      [["parts"], null, "The parts of a submission must be an array, found null."],
      [["items"], "x", 'The items of a submission must be an array, found "x".'],
      [["supplied"], 7, "The supplied of a submission must be an object, found 7."],
      [["supplied", "at"], -1e16, /^The time of the supplied of a submission must be epoch milliseconds/],
      [
        ["supplied", "scorer"],
        "x",
        'The scorer of the supplied of a submission must be "human" or "externalMachine", found "x".',
      ],
      [["supplied", "value"], 5, "The value of the supplied of a submission must be a wire value or null, found 5."],
      [["declaration", "cardinality"], "pair", /^The cardinality of the declaration of a submission must be /],
      [["declaration", "baseType"], "text", /^The base type of the declaration of a submission must be /],
      [
        ["declaration", "normalMaximum"],
        "10",
        'The normalMaximum of the declaration of a submission must be a finite number, found "10".',
      ],
      [
        ["declaration", "interpretation"],
        1,
        "The interpretation of the declaration of a submission must be a string, found 1.",
      ],
      [["declaration"], { cardinality: "record", baseType: "float" }, 'A record has no base type, found "float".'],
      [
        ["parts", 0, "item", "instance"],
        0,
        "The instance of the item of a part of a submission must be a positive integer, found 0.",
      ],
      [["parts", 0, "presented"], "yes", 'The presented of a part of a submission must be true or false, found "yes".'],
      [["parts", 0, "label"], 1, "The label of a part of a submission must be a string, found 1."],
      [["parts", 0, "value"], [1], "The value of a part of a submission must be a wire value or null, found an array."],
      [["items", 0, "title"], null, "The title of an item of a submission must be a string, found null."],
      [
        ["items", 0, "body"],
        [null],
        "The body of an item of a submission must hold nodes, each an object with a string kind, found null.",
      ],
      [
        ["items", 0, "templateValues"],
        {},
        "The templateValues of an item of a submission must be an array, found an object.",
      ],
      [
        ["items", 0, "correctResponses"],
        [{ identifier: 1, value: null }],
        "An identifier of the correctResponses of an item of a submission must be a string, found 1.",
      ],
    ];
    for (const [path, value, message] of cases) {
      const input = changed(path, value);
      expect(() => checkSubmission(input), path.join(".")).toThrow(
        typeof message === "string" ? new DataError(message) : message,
      );
    }
  });

  it("[T110] rejects a part that names an item the submission lacks, and an item that it has twice", () => {
    expect(() => checkSubmission(changed(["parts", 0, "item", "instance"], 2))).toThrow(
      new DataError('A part of a submission names the item "e" instance 2, which the submission lacks.'),
    );
    expect(() => checkSubmission(changed(["items"], [SUBMISSION.items[0], SUBMISSION.items[0]]))).toThrow(
      new DataError('A submission has the item "e" instance 1 twice.'),
    );
  });
});

describe("properties", () => {
  const seq = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
  const payload = fc.jsonValue();

  it("accepts every action envelope with a sequence number and an action, whatever the action", () => {
    fc.assert(
      fc.property(seq, payload, (number, anyAction) => {
        const envelope: unknown = json(JSON.stringify({ seq: number, action: anyAction }));
        checkActionEnvelope(envelope);
        expect(envelope.seq).toBe(number);
      }),
    );
  });

  it("accepts every view envelope with a sequence number, a view and string base URLs", () => {
    const assetsOf = fc.dictionary(fc.string(), fc.string());
    fc.assert(
      fc.property(seq, payload, assetsOf, (number, anyView, assets) => {
        const envelope: unknown = json(JSON.stringify({ seq: number, view: anyView, assets }));
        checkViewEnvelope(envelope);
        expect(Object.keys(envelope.assets)).toEqual(Object.keys(assets));
      }),
    );
  });

  it("rejects an action envelope with any property but seq and action", () => {
    const extra = fc.string().filter((key) => key !== "seq" && key !== "action");
    fc.assert(
      fc.property(seq, extra, (number, key) => {
        const envelope: unknown = json(JSON.stringify({ seq: number, action: {}, [key]: 1 }));
        expect(() => checkActionEnvelope(envelope)).toThrow(DataError);
      }),
    );
  });

  it("rejects every number that is not a non-negative safe integer as a sequence number", () => {
    const bad = fc.oneof(
      fc.integer({ max: -1 }),
      fc.double({ noInteger: true, noNaN: true, noDefaultInfinity: true }),
      fc.integer({ min: 2 ** 53, max: 2 ** 60 }),
    );
    fc.assert(
      fc.property(bad, (number) => {
        const envelope: unknown = json(JSON.stringify({ seq: number, action: {} }));
        expect(() => checkActionEnvelope(envelope)).toThrow(DataError);
      }),
    );
  });
});
