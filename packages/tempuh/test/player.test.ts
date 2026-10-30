import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DataError, EN_MESSAGES, ID_MESSAGES } from "../src/index.js";
import { buildStart, checkPciFrameOptions, type PciFrameOptions } from "../src/player/pci/options.js";
import {
  buildFrameCsp,
  isRequestedStatus,
  type PciFrameMessage,
  readFrameMessage,
  toJson,
} from "../src/player/pci/protocol.js";

/** Parses JSON text, so that a test passes input as JavaScript or JSON delivers it. */
const json = (text: string): unknown => JSON.parse(text);

/** The sources of each directive of a policy. */
function directives(policy: string): ReadonlyMap<string, readonly string[]> {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name = "", ...sources] = directive.split(" ");
      return [name, sources] as const;
    }),
  );
}

describe("isRequestedStatus", () => {
  it("[T52] accepts the statuses that BPIG §3.7.12.7.2 lists for ondone and no other", () => {
    for (const status of ["interacting", "closed", "solution", "review"]) expect(isRequestedStatus(status)).toBe(true);
    for (const status of ["suspended", "", "Closed", json("null"), json("1")])
      expect(isRequestedStatus(status)).toBe(false);
  });
});

describe("buildFrameCsp", () => {
  const origin = "https://assets.example";
  const policy = directives(buildFrameCsp(origin, []));

  it("[T53] allows nothing by default, and scripts only from the origin of the frame", () => {
    expect(policy.get("default-src")).toEqual(["'none'"]);
    expect(policy.get("script-src")).toEqual([origin]);
  });

  it("[T53] allows inline styles in the frame, and inline images, media and fonts, which reach no network", () => {
    expect(policy.get("style-src")).toEqual([origin, "'unsafe-inline'"]);
    expect(policy.get("img-src")).toEqual([origin, "data:"]);
    expect(policy.get("media-src")).toEqual([origin, "data:"]);
    expect(policy.get("font-src")).toEqual([origin, "data:"]);
  });

  it("[T53] forbids connections, frames, forms and a base element", () => {
    for (const name of ["connect-src", "frame-src", "form-action", "base-uri"]) {
      expect(policy.get(name), name).toEqual(["'none'"]);
    }
  });

  it("[T53] allows no inline script and no evaluation of strings", () => {
    const sources = [...policy.entries()].filter(([name]) => name !== "style-src").flatMap(([, list]) => list);
    expect(sources).not.toContain("'unsafe-inline'");
    expect(sources).not.toContain("'unsafe-eval'");
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("[T49] adds the allowed origins to the scripts, styles, images, media and fonts", () => {
    const wider = directives(buildFrameCsp(origin, ["https://cdn.example", "https://fonts.example"]));
    for (const name of ["script-src", "style-src", "img-src", "media-src", "font-src"]) {
      expect(wider.get(name), name).toEqual(
        expect.arrayContaining([origin, "https://cdn.example", "https://fonts.example"]),
      );
    }
    expect(wider.get("connect-src")).toEqual(["'none'"]);
  });
});

describe("toJson", () => {
  it("[T52] turns undefined, which getResponse gives for no response, into null", () => {
    expect(toJson(undefined)).toBeNull();
  });

  it("[T52] keeps JSON, and loses what JSON loses", () => {
    expect(toJson({ base: { integer: 3 } })).toEqual({ base: { integer: 3 } });
    expect(toJson({ a: undefined, b: () => 1, c: new Date(0) })).toEqual({ c: "1970-01-01T00:00:00.000Z" });
    expect(toJson(new Map([[1, 2]]))).toEqual({});
  });

  it("keeps a key named __proto__ as data", () => {
    const parsed = toJson(json('{"__proto__": {"base": null}}'));
    expect(Object.keys(parsed as object)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it("rejects a cycle and a BigInt", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => toJson(cycle)).toThrow(DataError);
    expect(() => toJson(1n)).toThrow("A value must be JSON, found a value with a cycle, a BigInt or too many levels.");
  });
});

describe("readFrameMessage", () => {
  const read = (text: string): PciFrameMessage => readFrameMessage(json(text));

  it("[T52] reads each message that the frame sends", () => {
    expect(read('{"type":"loaded"}')).toEqual({ type: "loaded" });
    expect(read('{"type":"ready","state":"{}"}')).toEqual({ type: "ready", state: "{}" });
    expect(read('{"type":"changed","response":{"base":{"integer":1}},"state":"s","valid":false}')).toEqual({
      type: "changed",
      response: { base: { integer: 1 } },
      state: "s",
      valid: false,
    });
    expect(read('{"type":"done","response":null,"state":"s","status":"review"}')).toEqual({
      type: "done",
      response: null,
      state: "s",
      status: "review",
    });
    expect(read('{"type":"height","height":120}')).toEqual({ type: "height", height: 120 });
    expect(read('{"type":"validity","id":3,"value":"Too few."}')).toEqual({
      type: "validity",
      id: 3,
      value: "Too few.",
    });
    expect(read('{"type":"completed","flushed":{"response":{"base":null},"state":"s"}}')).toEqual({
      type: "completed",
      flushed: { response: { base: null }, state: "s" },
    });
    expect(read('{"type":"completed","flushed":null}')).toEqual({ type: "completed", flushed: null });
    expect(read('{"type":"failed","reason":"register"}')).toEqual({ type: "failed", reason: "register" });
  });

  it("[T52] takes a change with no validity, and a response of undefined, as a structured clone delivers them", () => {
    expect(readFrameMessage({ type: "changed", response: undefined, state: "s", valid: undefined })).toEqual({
      type: "changed",
      response: null,
      state: "s",
      valid: undefined,
    });
    expect(readFrameMessage({ type: "validity", id: 0, value: undefined })).toEqual({
      type: "validity",
      id: 0,
      value: undefined,
    });
  });

  it("[T53] rejects what is not an object, and an object of another type", () => {
    for (const text of ["null", "[]", '"loaded"', "5", "true"]) {
      expect(() => read(text), text).toThrow(/^A message from the frame must be an object, found /);
    }
    expect(() => read('{"type":"navigate"}')).toThrow(
      /^A message from the frame has the type "loaded", .* found "navigate"\.$/,
    );
    expect(() => read("{}")).toThrow("found undefined.");
  });

  it("[T53] rejects a state that is not a string", () => {
    expect(() => read('{"type":"ready","state":5}')).toThrow(
      new DataError("The state of an interaction must be a string, found 5."),
    );
    expect(() => read('{"type":"changed","response":null}')).toThrow("found undefined.");
    expect(() => read('{"type":"done","response":null,"state":null,"status":"closed"}')).toThrow("found null.");
    expect(() => read('{"type":"completed","flushed":{"response":null}}')).toThrow("The state of an interaction");
  });

  it("[T53] rejects a height that is not a non-negative integer", () => {
    for (const text of ['"9"', "-1", "1.5", "null", "[]"]) {
      expect(() => read(`{"type":"height","height":${text}}`), text).toThrow(/^The height of the frame must be/);
    }
    expect(() => readFrameMessage({ type: "height", height: Number.POSITIVE_INFINITY })).toThrow(DataError);
    expect(() => readFrameMessage({ type: "height", height: Number.NaN })).toThrow(DataError);
  });

  it("[T52] rejects a status that ondone does not know, a validity that is not a boolean, and a failure that is not listed", () => {
    expect(() => read('{"type":"done","response":null,"state":"s","status":"suspended"}')).toThrow(
      /^The status that an interaction asks for must be "interacting", "closed", "solution" or "review", found "suspended"\./,
    );
    expect(() => read('{"type":"changed","response":null,"state":"s","valid":"yes"}')).toThrow(
      new DataError('The validity of an interaction must be a boolean or undefined, found "yes".'),
    );
    expect(() => read('{"type":"validity","id":1,"value":5}')).toThrow(
      "A validity method gives a boolean, a string or undefined",
    );
    expect(() => read('{"type":"validity","id":-1,"value":true}')).toThrow("The identifier of a validity request");
    expect(() => read('{"type":"failed","reason":"everything"}')).toThrow('found "everything".');
    expect(() => read('{"type":"completed","flushed":5}')).toThrow(
      new DataError("The final state of an interaction must be an object or null, found 5."),
    );
  });

  it("[T53] rejects a response that has a cycle", () => {
    const response: Record<string, unknown> = {};
    response.self = response;
    expect(() => readFrameMessage({ type: "done", response, state: "s", status: "closed" })).toThrow(DataError);
  });
});

const GATE = "https://assets.example/g/t0k3n/";

/** The smallest options that `checkPciFrameOptions` accepts. */
const MINIMAL: PciFrameOptions = {
  staticUrl: "https://assets.example/static/",
  messages: EN_MESSAGES,
  prompt: null,
  language: "en",
  stylesheets: [],
  markup: "",
  modules: { baseUrl: `${GATE}modules/`, paths: new Map([["tap", [`${GATE}modules/tap`]]]), load: ["tap"] },
  typeIdentifier: "urn:fdc:hmhco.com:pci:tapToReveal",
  responseIdentifier: "RESPONSE",
  status: "interacting",
  boundTo: { base: null },
  onEvent: () => undefined,
};

/** Calls `checkPciFrameOptions` with the options changed, as plain JavaScript passes them. */
const check = (changes: Readonly<Record<string, unknown>>): void => checkPciFrameOptions({ ...MINIMAL, ...changes });

describe("checkPciFrameOptions", () => {
  it("[T49] accepts the smallest options, and the options with every optional one", () => {
    expect(() => checkPciFrameOptions(MINIMAL)).not.toThrow();
    expect(() =>
      check({
        origins: ["https://cdn.example", "http://localhost:8080"],
        className: "qti-orientation-horizontal",
        properties: new Map([["labelMin", "Low"]]),
        templateVariables: new Map([["X", { base: { integer: 1 } }]]),
        contextVariables: new Map(),
        state: "{}",
        modules: { ...MINIMAL.modules, waitSeconds: 0 },
      }),
    ).not.toThrow();
  });

  it("[T49] rejects options that are not an object, and an option that is not known", () => {
    for (const text of ["null", "[]", '"x"']) {
      expect(() => checkPciFrameOptions(json(text)), text).toThrow(/^The options must be an object, found /);
    }
    expect(() => check({ origin: "https://cdn.example" })).toThrow(
      /^The options has the properties "staticUrl", .* found "origin"\.$/,
    );
  });

  it("[T49] rejects a static URL and a base URL that are not an absolute http URL ending in a slash", () => {
    expect(() => check({ staticUrl: "https://assets.example/static" })).toThrow(
      new DataError('The option staticUrl must end in "/", found "https://assets.example/static".'),
    );
    expect(() => check({ staticUrl: "/static/" })).toThrow(
      /^The option staticUrl must be an absolute http or https URL/,
    );
    expect(() => check({ staticUrl: "javascript:alert(1)//" })).toThrow(
      /^The option staticUrl must be an absolute http or https URL/,
    );
    expect(() => check({ staticUrl: json("5") })).toThrow("The option staticUrl must be a string, found 5.");
    expect(() => check({ modules: { ...MINIMAL.modules, baseUrl: "https://assets.example/g/t/modules" } })).toThrow(
      /^The base URL of the modules must end in "\/"/,
    );
  });

  it("[T49] rejects an origin that is more than a scheme, a host and a port", () => {
    for (const origin of [
      "https://cdn.example/",
      "https://cdn.example/path",
      "cdn.example",
      "ftp://cdn.example",
      "*",
    ]) {
      expect(() => check({ origins: [origin] }), origin).toThrow(DataError);
    }
    expect(() => check({ origins: [json("5")] })).toThrow("An origin must be a string, found 5.");
    expect(() => check({ origins: json("{}") })).toThrow("The option origins must be an array, found an object.");
  });

  it("[T49] rejects modules that are not the base URL, a Map of locations, a number of seconds and names", () => {
    const modules = MINIMAL.modules;
    expect(() => check({ modules: json("null") })).toThrow("The option modules must be an object, found null.");
    expect(() => check({ modules: { ...modules, extra: 1 } })).toThrow(/^The option modules has the properties/);
    expect(() => check({ modules: { ...modules, paths: json("{}") } })).toThrow(
      "The paths of the modules must be a Map, found an object.",
    );
    expect(() => check({ modules: { ...modules, paths: new Map([["tap", "https://x.example/tap"]]) } })).toThrow(
      'The locations of the module "tap" must be an array',
    );
    expect(() => check({ modules: { ...modules, paths: new Map([["tap", ["tap"]]]) } })).toThrow(
      /^A location of the module "tap" must be an absolute http or https URL/,
    );
    expect(() => check({ modules: { ...modules, paths: new Map([["", [`${GATE}x`]]]) } })).toThrow(
      "The name of a module",
    );
    expect(() => check({ modules: { ...modules, waitSeconds: -1 } })).toThrow(
      "The option waitSeconds must be a non-negative integer, found -1.",
    );
    expect(() => check({ modules: { ...modules, waitSeconds: json("null") } })).toThrow("found null.");
    expect(() => check({ modules: { ...modules, load: [""] } })).toThrow("A module to load must be a non-empty string");
    expect(() => check({ modules: { ...modules, load: json("null") } })).toThrow(
      "The modules to load must be an array",
    );
  });

  it("[T50] rejects properties, variables and a state of the wrong type", () => {
    expect(() => check({ properties: json("{}") })).toThrow("The option properties must be a Map, found an object.");
    expect(() => check({ properties: new Map([["a", 1]]) })).toThrow('The property "a" must be a string, found 1.');
    expect(() => check({ properties: new Map([["", "a"]]) })).toThrow("A name in The option properties");
    expect(() => check({ templateVariables: json("[]") })).toThrow("The option templateVariables must be a Map");
    expect(() => check({ contextVariables: new Map([["X", 1n]]) })).toThrow("A value must be JSON");
    expect(() => check({ state: json("5") })).toThrow("The option state must be a string, found 5.");
    expect(() => check({ state: json("null") })).not.toThrow();
  });

  it("[T49] rejects a status, a prompt, a language, a class and markup of the wrong type", () => {
    expect(() => check({ status: "paused" })).toThrow(
      'The option status must be "interacting", "suspended", "closed", "solution" or "review", found "paused".',
    );
    expect(() => check({ prompt: json("5") })).toThrow("The option prompt must be a string, found 5.");
    expect(() => check({ prompt: undefined })).toThrow("The option prompt must be a string, found undefined.");
    expect(() => check({ language: "" })).toThrow("The option language must be a non-empty string");
    expect(() => check({ className: json("null") })).toThrow("The option className must be a string, found null.");
    expect(() => check({ markup: json("null") })).toThrow("The option markup must be a string, found null.");
    expect(() => check({ typeIdentifier: "" })).toThrow("The option typeIdentifier must be a non-empty string");
    expect(() => check({ responseIdentifier: json("5") })).toThrow(
      "The option responseIdentifier must be a non-empty string",
    );
    expect(() => check({ stylesheets: ["item.css"] })).toThrow(
      /^A stylesheet of the option stylesheets must be an absolute/,
    );
    expect(() => check({ messages: json("null") })).toThrow("The option messages must be an object, found null.");
    expect(() => check({ messages: {} })).toThrow("The message interactiveQuestion must be a non-empty string");
    expect(() => check({ onEvent: json("null") })).toThrow("The option onEvent must be a function, found null.");
  });
});

describe("buildStart", () => {
  it("[T50] fills the defaults: no origins, no class, seven seconds, no properties, no state", () => {
    const start = buildStart(MINIMAL);
    expect(start).toMatchObject({
      type: "start",
      language: "en",
      className: "",
      origins: [],
      markup: "",
      typeIdentifier: "urn:fdc:hmhco.com:pci:tapToReveal",
      responseIdentifier: "RESPONSE",
      status: "interacting",
      boundTo: { base: null },
      state: null,
    });
    expect(start.modules).toEqual({ ...MINIMAL.modules, waitSeconds: 7 });
    expect(start.properties.size + start.templateVariables.size + start.contextVariables.size).toBe(0);
  });

  it("[T49] keeps a wait of 0, which waits for ever", () => {
    expect(buildStart({ ...MINIMAL, modules: { ...MINIMAL.modules, waitSeconds: 0 } }).modules.waitSeconds).toBe(0);
  });

  it("[T50] puts player.css from the static URL before the stylesheets of the item", () => {
    const start = buildStart({ ...MINIMAL, stylesheets: [`${GATE}styles/item.css`] });
    expect(start.stylesheets).toEqual(["https://assets.example/static/player.css", `${GATE}styles/item.css`]);
  });

  it("[T50] keeps the properties, and turns the values of variables into JSON", () => {
    const start = buildStart({
      ...MINIMAL,
      properties: new Map([["labelMin", "Low"]]),
      templateVariables: new Map([["X", { base: { integer: 1 } }]]),
      contextVariables: new Map([["LIMIT", undefined]]),
      boundTo: undefined,
      state: "{}",
    });
    expect(start.properties).toEqual(new Map([["labelMin", "Low"]]));
    expect(start.templateVariables).toEqual(new Map([["X", { base: { integer: 1 } }]]));
    expect(start.contextVariables).toEqual(new Map([["LIMIT", null]]));
    expect(start.boundTo).toBeNull();
    expect(start.state).toBe("{}");
  });

  it("[SC 4.1.2] names the frame from the prompt, with its white space collapsed, else by the message", () => {
    expect(buildStart({ ...MINIMAL, prompt: "  Which\n  is   larger? " }).title).toBe("Which is larger?");
    expect(buildStart({ ...MINIMAL, prompt: null }).title).toBe("Interactive question");
    expect(buildStart({ ...MINIMAL, prompt: " \n\t " }).title).toBe("Interactive question");
    expect(buildStart({ ...MINIMAL, prompt: "", messages: ID_MESSAGES }).title).toBe("Soal interaktif");
  });
});

describe("properties", () => {
  it("[T53] gives a message of a known type or throws a DataError, for any value", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        try {
          expect(["loaded", "ready", "changed", "done", "height", "validity", "completed", "failed"]).toContain(
            readFrameMessage(value).type,
          );
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
      }),
    );
  });

  it("[T53] reads every height message that has a non-negative safe integer", () => {
    fc.assert(
      fc.property(fc.nat(), (height) => {
        expect(readFrameMessage({ type: "height", height })).toEqual({ type: "height", height });
      }),
    );
  });

  it("[T52] gives a response that is JSON, whatever the frame sent", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (response) => {
        const message = readFrameMessage({ type: "changed", response, state: "s", valid: true });
        expect(message.type === "changed" && JSON.stringify(message.response)).toBe(JSON.stringify(response));
      }),
    );
  });
});
