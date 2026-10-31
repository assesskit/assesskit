import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isRecord } from "@assesskit/runtime/checks";
import {
  actionToJson,
  type CandidateAction,
  type CandidateView,
  type DeliveryEvent,
  type HostAction,
  type RefusalCode,
} from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { AssessmentResult } from "@assesskit/runtime/results";
import { single } from "@assesskit/runtime/values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import protocolGuide from "../../../docs/player/protocol.md?raw";
import readme from "../README.md?raw";
import { createLocalSession } from "../src/client/index.js";
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
import { checkCallOptions, checkHostAction, checkHostApplyOptions, markOfficial } from "../src/protocol/internal.js";
import { examDefinition, examHost, packageOf, ratedFiles } from "./exam-fixture.js";
import { fuzzJson } from "./fuzz.js";
import { runGuideSamples } from "./guide-samples.js";
import { localOptions } from "./local-fixture.js";

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
      expect(() => checkCaller(json(text)), text).toThrow(/^The caller is invalid: expected an object, found /);
    }
  });

  it("rejects a session or a principal that is missing, empty or not a string", () => {
    expect(() => checkCaller(json('{"principal":"p1"}'))).toThrow(
      new DataError('The caller is invalid: missing the property "session".'),
    );
    expect(() => checkCaller(json('{"session":"","principal":"p1"}'))).toThrow(
      new DataError("The caller is invalid at session: expected a length of at least 1, found 0."),
    );
    expect(() => checkCaller(json('{"session":"s1"}'))).toThrow(
      new DataError('The caller is invalid: missing the property "principal".'),
    );
    expect(() => checkCaller(json('{"session":"s1","principal":7}'))).toThrow(
      new DataError("The caller is invalid at principal: expected a string, found 7."),
    );
  });
});

describe("checkActionEnvelope", () => {
  it("accepts an envelope with a sequence number and an action", () => {
    const envelope: unknown = json(JSON.stringify({ seq: 3, action }));
    expect(() => checkActionEnvelope(envelope)).not.toThrow();
  });

  it("accepts any action, which the runtime's parser reads", () => {
    for (const text of ["null", "5", '"move"', "[]", "{}"]) {
      expect(() => checkActionEnvelope(json(`{"seq":0,"action":${text}}`)), text).not.toThrow();
    }
  });

  it("rejects what is not an object", () => {
    for (const text of ["null", "[]", '"seq"', "5"]) {
      expect(() => checkActionEnvelope(json(text)), text).toThrow(
        /^An action envelope is invalid: expected an object, found /,
      );
    }
  });

  it("rejects a session identifier, which an envelope never carries", () => {
    expect(() => checkActionEnvelope(json('{"seq":1,"action":{},"session":"s2"}'))).toThrow(
      new DataError('An action envelope is invalid: unexpected property "session".'),
    );
  });

  it("rejects a sequence number that is not a non-negative integer", () => {
    for (const text of ['"1"', "-1", "1.5", "null", "1e300"]) {
      expect(() => checkActionEnvelope(json(`{"seq":${text},"action":{}}`)), text).toThrow(
        /^An action envelope is invalid at seq: expected /,
      );
    }
    expect(() => checkActionEnvelope(json('{"action":{}}'))).toThrow(
      'An action envelope is invalid: missing the property "seq".',
    );
  });

  it("rejects an envelope without an action", () => {
    expect(() => checkActionEnvelope(json('{"seq":1}'))).toThrow(
      new DataError('An action envelope is invalid: missing the property "action".'),
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
      expect(() => checkViewEnvelope(json(text)), text).toThrow(
        /^A view envelope is invalid: expected an object, found /,
      );
    }
  });

  it("rejects a property that an envelope does not have", () => {
    expect(() => checkViewEnvelope(json('{"seq":1,"view":{},"assets":{},"principal":"p1"}'))).toThrow(
      new DataError('A view envelope is invalid: unexpected property "principal".'),
    );
  });

  it("rejects a sequence number that is not a non-negative integer", () => {
    expect(() => checkViewEnvelope(json('{"seq":-2,"view":{},"assets":{}}'))).toThrow(
      new DataError("A view envelope is invalid at seq: expected a value of at least 0, found -2."),
    );
  });

  it("rejects an envelope without a view", () => {
    expect(() => checkViewEnvelope(json('{"seq":1,"assets":{}}'))).toThrow(
      new DataError('A view envelope is invalid: missing the property "view".'),
    );
  });

  it("rejects assets that are not an object of strings", () => {
    expect(() => checkViewEnvelope(json('{"seq":1,"view":{}}'))).toThrow(
      new DataError('A view envelope is invalid: missing the property "assets".'),
    );
    expect(() => checkViewEnvelope(json('{"seq":1,"view":{},"assets":["a/"]}'))).toThrow("found an array.");
    expect(() => checkViewEnvelope(json('{"seq":1,"view":{},"assets":{"items/q1/":5}}'))).toThrow(
      new DataError(
        'A view envelope is invalid at assets: the property "items/q1/" is invalid: expected a string, found 5.',
      ),
    );
  });
});

describe("checkViewEnvelope: documents and refusal", () => {
  const base = { seq: 2, view: {}, assets: {} };

  it("accepts the documents of a view and the refusal of an action", () => {
    const documents = {
      test: "tests/exam.xml",
      item: "items/q1/item.xml",
      stimuli: ["stimuli/s1.xml"],
      lexicons: ["items/q1/words.pls"],
    };
    const refusal = { code: "time-over", message: "The time is over." };
    expect(() => checkViewEnvelope(json(JSON.stringify({ ...base, documents, refusal })))).not.toThrow();
  });

  it("rejects documents that are not an object of the test, the item, the stimuli and the lexicons", () => {
    const check = (documents: string): void =>
      checkViewEnvelope(json(`{"seq":2,"view":{},"assets":{},"documents":${documents}}`));
    expect(() => check("[]")).toThrow("A view envelope is invalid at documents: expected an object, found an array.");
    expect(() => check('{"test":"","item":"","lexicons":[]}')).toThrow(
      'A view envelope is invalid at documents: missing the property "stimuli".',
    );
    expect(() => check('{"test":1,"item":"","stimuli":[],"lexicons":[]}')).toThrow(
      "A view envelope is invalid at documents.test: expected a string, found 1.",
    );
    expect(() => check('{"test":"","item":"","stimuli":[5],"lexicons":[]}')).toThrow(
      "A view envelope is invalid at documents.stimuli[0]: expected a string, found 5.",
    );
    expect(() => check('{"test":"","item":"","stimuli":[]}')).toThrow(
      'A view envelope is invalid at documents: missing the property "lexicons".',
    );
    expect(() => check('{"test":"","item":"","stimuli":[],"lexicons":[5]}')).toThrow(
      "A view envelope is invalid at documents.lexicons[0]: expected a string, found 5.",
    );
    expect(() => check('{"test":"","item":"","stimuli":[],"lexicons":[],"other":1}')).toThrow(
      'A view envelope is invalid at documents: unexpected property "other".',
    );
  });

  it("rejects a refusal that is not one of the runtime's", () => {
    const check = (refusal: string): void =>
      checkViewEnvelope(json(`{"seq":2,"view":{},"assets":{},"refusal":${refusal}}`));
    expect(() => check("5")).toThrow("A view envelope is invalid at refusal: expected an object, found 5.");
    expect(() => check('{"code":"nope","message":"m"}')).toThrow(
      'A view envelope is invalid at refusal.code: expected "attempts-exhausted", "awaiting-cat", "clock-regression", "comment-not-allowed", "ended", "invalid-response", "item-closed", "linear-backward", "min-time-not-reached", "not-current", "review-not-allowed", "score-type-mismatch", "skipping-not-allowed", "solution-not-allowed", "support-not-available", "suspended", "time-over", "unknown-item", "unknown-request", "value-out-of-range" or "wrong-submission-mode", found "nope".',
    );
    expect(() => check('{"code":"ended","message":1}')).toThrow(
      "A view envelope is invalid at refusal.message: expected a string, found 1.",
    );
    expect(() => check('{"code":"ended"}')).toThrow(
      'A view envelope is invalid at refusal: missing the property "message".',
    );
    expect(() => check('{"code":"ended","message":"m","at":1}')).toThrow(
      'A view envelope is invalid at refusal: unexpected property "at".',
    );
  });
});

describe("REFUSAL_CODES", () => {
  it("lists every refusal code of the runtime", () => {
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
    for (const code of REFUSAL_CODES) expect(() => checkRefusal({ code, message: "m" })).not.toThrow();
  });

  it("are the codes that the table of refusal codes in the delivery guide of the runtime lists", () => {
    const guide = readFileSync(resolve(import.meta.dirname, "../../../docs/runtime/delivery.md"), "utf8");
    const listed = [...guide.matchAll(/^\| `([a-z-]+)` +\| [^|]+ \|$/gm)].map(([, code = ""]) => code);
    for (const code of REFUSAL_CODES) expect(listed, code).toContain(code);
  });
});

describe("viewDocuments", () => {
  const view = (current: unknown): CandidateView =>
    JSON.parse(JSON.stringify({ test: { identifier: "t", title: "T" }, current }));
  const source = {
    test: "tests/t.xml",
    item: (reference: string) =>
      reference === "q1"
        ? { path: "items/q1.xml", stimuli: ["stimuli/s.xml"], lexicons: ["items/words.pls"] }
        : undefined,
  };

  it("names the documents of the item presented and the test", () => {
    expect(viewDocuments(view({ key: { ref: "q1", instance: 1 } }), source)).toEqual({
      test: "tests/t.xml",
      item: "items/q1.xml",
      stimuli: ["stimuli/s.xml"],
      lexicons: ["items/words.pls"],
    });
  });

  it("resolves against the root of the package for a variant, an unknown item, no item, and no source", () => {
    const root = { test: "tests/t.xml", item: "", stimuli: [], lexicons: [] };
    expect(viewDocuments(view({ key: { ref: "q1", instance: 1 }, variant: { resource: "v" } }), source)).toEqual(root);
    expect(viewDocuments(view({ key: { ref: "q9", instance: 1 } }), source)).toEqual(root);
    expect(viewDocuments(view(undefined), source)).toEqual(root);
    expect(viewDocuments(view({ key: { ref: "q1", instance: 1 } }), undefined)).toEqual({
      test: "",
      item: "",
      stimuli: [],
      lexicons: [],
    });
  });
});

describe("checkHostAction", () => {
  it("accepts the types of the actions of the host", () => {
    for (const type of ["time", "supply-scores", "cat-response"]) {
      expect(() => checkHostAction(json(JSON.stringify({ type }))), type).not.toThrow();
    }
  });

  it("rejects an action of the candidate and a type that does not exist", () => {
    for (const type of ["move", "set-responses", "suspend", "nope"]) {
      expect(() => checkHostAction(json(JSON.stringify({ type }))), type).toThrow(
        new DataError(
          `The type of a host action must be "time", "supply-scores" or "cat-response", found ${JSON.stringify(type)}.`,
        ),
      );
    }
  });

  it("rejects what is not an object with a type", () => {
    for (const text of ["null", "5", '"time"', "[]", "{}"]) {
      expect(() => checkHostAction(json(text)), text).toThrow(DataError);
    }
    expect(() => checkHostAction(json("null"))).toThrow("The action must be an object with a type, found null.");
  });
});

describe("the options of a session call", () => {
  it("accept absent options, no property and a signal", () => {
    const signal = new AbortController().signal;
    for (const check of [checkCallOptions, checkHostApplyOptions]) {
      expect(() => check(undefined)).not.toThrow();
      expect(() => check({})).not.toThrow();
      expect(() => check({ signal })).not.toThrow();
      expect(() => check({ signal: undefined })).not.toThrow();
    }
    expect(() => checkHostApplyOptions({ signal, scoredBy: "https://rater.example/1" })).not.toThrow();
  });

  it("refuse null, an array, a signal of another type and a property they do not know", () => {
    for (const check of [checkCallOptions, checkHostApplyOptions]) {
      expect(() => check(json("null"))).toThrow(new DataError("The options must be an object, found null."));
      expect(() => check(json("[]"))).toThrow(new DataError("The options must be an object, found an array."));
      expect(() => check(json('{"signal":5}'))).toThrow(
        new DataError("The option signal must be an AbortSignal, found 5."),
      );
      expect(() => check(json('{"signal":null}'))).toThrow(
        new DataError("The option signal must be an AbortSignal, found null."),
      );
      expect(() => check(json('{"timeout":1}'))).toThrow(DataError);
    }
  });

  it("refuse a scoredBy that is not a string only where the host applies an action", () => {
    expect(() => checkHostApplyOptions(json('{"scoredBy":5}'))).toThrow(
      new DataError("The option scoredBy must be a string, found 5."),
    );
    expect(() => checkCallOptions(json('{"scoredBy":"x"}'))).toThrow(DataError);
  });
});

describe("the frame of an LTI item", () => {
  const frame = { url: "https://tool.example.com/lti/login", storageUrl: "https://lti.platform.example/storage" };

  it("names the frames of the tool and of the storage page, which the storage page and the tool look for by name", () => {
    expect([LTI_TOOL_FRAME, LTI_STORAGE_FRAME]).toEqual(["lti-tool", "lti-storage"]);
  });

  it("accepts a frame with two URLs, with or without an allow list", () => {
    expect(() => checkLtiFrame(frame)).not.toThrow();
    expect(() =>
      checkLtiFrame({ ...frame, allow: "microphone; camera 'self' https://tool.example.com" }),
    ).not.toThrow();
    expect(() =>
      checkLtiFrame({ url: "http://127.0.0.1:8080/login", storageUrl: "http://127.0.0.1:8081/storage" }),
    ).not.toThrow();
  });

  it("rejects what is not a frame", () => {
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

  it("accepts an allow list of the characters of a Permissions Policy and rejects any other", () => {
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

  it("marks the report that the host brands, and no copy of it", () => {
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

  it("marks nothing that is not an object", () => {
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
  it("accepts a submission with every part of its form", () => {
    expect(() => checkSubmission(json(JSON.stringify(SUBMISSION)))).not.toThrow();
  });

  it("accepts the optional parts left out, a record declaration and NULL values", () => {
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

  it("rejects what is not an object, and a property that its form lacks", () => {
    for (const text of ["null", "[]", '"s"', "5"]) {
      expect(() => checkSubmission(json(text)), text).toThrow(/^A submission is invalid: expected an object, found /);
    }
    expect(() => checkSubmission(changed(["session"], "s1"))).toThrow(
      /^A submission is invalid: unexpected property "session"\.$/,
    );
    expect(() => checkSubmission(changed(["items", 0, "secret"], 1))).toThrow(
      /^A submission is invalid at items\[0\]: unexpected property "secret"\.$/,
    );
  });

  it("rejects a field of another type, and says which", () => {
    const cases: readonly (readonly [readonly Step[], unknown, string | RegExp])[] = [
      [["request"], "", "A submission is invalid at request: expected a length of at least 1, found 0."],
      [["outcome"], 5, "A submission is invalid at outcome: expected a string, found 5."],
      [["mode"], "robot", 'A submission is invalid at mode: expected "human" or "externalMachine", found "robot".'],
      [["lti"], false, "A submission is invalid at lti: expected true, found false."],
      [["variableIdentifierRef"], 1, "A submission is invalid at variableIdentifierRef: expected a string, found 1."],
      [["requestedAt"], "now", 'A submission is invalid at requestedAt: expected a number, found "now".'],
      [
        ["requestedAt"],
        253_402_300_800_000,
        "A submission is invalid at requestedAt: expected a value of at most 253402300799999, found 253402300800000.",
      ],
      [["rubric"], {}, "A submission is invalid at rubric: expected an array, found an object."],
      [["rubric"], [{ text: "x" }], 'A submission is invalid at rubric[0]: missing the property "kind".'],
      [["parts"], null, "A submission is invalid at parts: expected an array, found null."],
      [["items"], "x", 'A submission is invalid at items: expected an array, found "x".'],
      [["supplied"], 7, "A submission is invalid at supplied: expected an object, found 7."],
      [["supplied", "at"], -1e16, /^A submission is invalid at supplied\.at: expected a value of at least /],
      [
        ["supplied", "scorer"],
        "x",
        'A submission is invalid at supplied.scorer: expected "human" or "externalMachine", found "x".',
      ],
      [["supplied", "value"], 5, "A submission is invalid at supplied.value: expected an object, found 5."],
      [["declaration", "cardinality"], "pair", /^A submission is invalid at declaration\.cardinality: expected /],
      [["declaration", "baseType"], "text", /^A submission is invalid at declaration\.baseType: expected /],
      [
        ["declaration", "normalMaximum"],
        "10",
        'A submission is invalid at declaration.normalMaximum: expected a number, found "10".',
      ],
      [
        ["declaration", "interpretation"],
        1,
        "A submission is invalid at declaration.interpretation: expected a string, found 1.",
      ],
      [
        ["declaration"],
        { cardinality: "record", baseType: "float" },
        'A submission is invalid at declaration: unexpected property "baseType".',
      ],
      [
        ["parts", 0, "item", "instance"],
        0,
        "A submission is invalid at parts[0].item.instance: expected a value of at least 1, found 0.",
      ],
      [
        ["parts", 0, "presented"],
        "yes",
        'A submission is invalid at parts[0].presented: expected true or false, found "yes".',
      ],
      [["parts", 0, "label"], 1, "A submission is invalid at parts[0].label: expected a string, found 1."],
      [["parts", 0, "value"], [1], "A submission is invalid at parts[0].value: expected an object, found an array."],
      [["items", 0, "title"], null, "A submission is invalid at items[0].title: expected a string, found null."],
      [["items", 0, "body"], [null], "A submission is invalid at items[0].body[0]: expected an object, found null."],
      [
        ["items", 0, "templateValues"],
        {},
        "A submission is invalid at items[0].templateValues: expected an array, found an object.",
      ],
      [
        ["items", 0, "correctResponses"],
        [{ identifier: 1, value: null }],
        "A submission is invalid at items[0].correctResponses[0].identifier: expected a string, found 1.",
      ],
    ];
    for (const [path, value, message] of cases) {
      const input = changed(path, value);
      expect(() => checkSubmission(input), path.join(".")).toThrow(
        typeof message === "string" ? new DataError(message) : message,
      );
    }
  });

  it("rejects a part that names an item the submission lacks, and an item that it has twice", () => {
    expect(() => checkSubmission(changed(["parts", 0, "item", "instance"], 2))).toThrow(
      new DataError('A submission is invalid: A part names the item "e" instance 2, which the submission lacks.'),
    );
    expect(() => checkSubmission(changed(["items"], [SUBMISSION.items[0], SUBMISSION.items[0]]))).toThrow(
      new DataError('A submission is invalid: has the item "e" instance 1 twice.'),
    );
  });
});

describe("the host side of a session host and of a local session", () => {
  const Alice = { session: "exam-1", principal: "alice" };
  const Q2 = { ref: "q2", instance: 1 };
  const supply = (request: string, value: number): HostAction => ({
    type: "supply-scores",
    request,
    value: single("float", value),
    scorer: "human",
  });

  it("give equal pending work, scorer views, results and steps for one script", async () => {
    const files = ratedFiles();
    const { host, logged } = await examHost({}, files);
    await host.start(Alice, { seed: 1 });
    const server = host.session(Alice.session);
    const local = await createLocalSession({
      ...localOptions({ definition: examDefinition(packageOf(files)) }).options,
      seed: 1,
    });
    const feed: (readonly DeliveryEvent[])[] = [];
    local.host.subscribeSteps((events) => feed.push(events));

    let seq = 0;
    const candidate = async (action: CandidateAction): Promise<void> => {
      seq += 1;
      const answered = await host.handle(Alice, { seq, action: actionToJson(action) });
      const dispatched = await local.dispatch(action);
      expect(answered.refusal, JSON.stringify(action)).toEqual(dispatched.refusal);
    };
    const hosted = async (action: HostAction): Promise<void> => {
      expect(await server.apply(action), JSON.stringify(action)).toEqual(await local.host.apply(action));
    };
    const same = async (): Promise<readonly string[]> => {
      const pending = await local.host.pending();
      expect(await server.pending()).toEqual(pending);
      expect(await server.results()).toEqual(await local.host.results());
      for (const { id } of pending.scoring) {
        expect(await server.scorerView(id)).toEqual(await local.host.scorerView(id));
      }
      return pending.scoring.map(({ id }) => id);
    };

    expect(await same()).toEqual([]);
    await candidate({ type: "move", to: Q2 });
    await candidate({ type: "submit", item: { ref: "q3", instance: 1 } });
    await candidate({
      type: "set-responses",
      item: Q2,
      responses: new Map([["RESPONSE", single("string", "A word")]]),
    });
    await candidate({ type: "submit", item: Q2 });
    const [request] = await same();
    expect(request).toBe("item:q2:1:SCORE");
    await hosted({ type: "time" });
    await hosted(supply("none", 1));
    await hosted(supply(request ?? "", 7));
    await hosted(supply(request ?? "", 8));
    await candidate({ type: "end-test" });
    expect(await same()).toEqual([]);

    // The session host reports a step to its log after the save; the start is the step "start", which a local session has no feed for.
    expect(logged.slice(1).map(({ events }) => events)).toEqual(feed);
    expect(feed.length).toBeGreaterThan(3);
    expect(isOfficialResult(await server.results())).toBe(true);
    expect(isOfficialResult(await local.host.results())).toBe(false);
    local.close();
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const protocol = await import("../src/protocol/index.js");
    expect(await runGuideSamples(protocolGuide, { "@assesskit/player/protocol": protocol })).toBeGreaterThan(0);
  });

  it("shows the results that the example of the README gives", async () => {
    const modules = {
      "@assesskit/player": await import("../src/index.js"),
      "@assesskit/player/protocol": await import("../src/protocol/index.js"),
    };
    expect(await runGuideSamples(readme, modules)).toBe(2);
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

  it("reads or refuses arbitrary JSON with a DataError, and nothing else", () => {
    fuzzJson((value) => checkCaller(value), [{ session: "s1", principal: "p1" }]);
    fuzzJson((value) => checkActionEnvelope(value), [{ seq: 3, action }]);
    const envelope = { seq: 4, view, assets: { "items/q1/": "https://assets.example/g/token/" } };
    const documents = {
      test: "tests/exam.xml",
      item: "items/q1/item.xml",
      stimuli: ["stimuli/s1.xml"],
      lexicons: [],
    };
    const refusal = { code: "time-over", message: "The time is over." };
    fuzzJson((value) => checkViewEnvelope(value), [envelope, { ...envelope, documents, refusal }]);
    fuzzJson((value) => checkRefusal(value), [refusal]);
    fuzzJson((value) => checkSubmission(value), [SUBMISSION]);
  });
});
