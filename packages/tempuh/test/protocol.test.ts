import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DataError } from "../src/index.js";
import { checkActionEnvelope, checkCaller, checkViewEnvelope } from "../src/protocol/index.js";

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
      new DataError('A view envelope has the properties "seq", "view" and "assets", found "principal".'),
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
