import { readAsi } from "@assesskit/runtime/asi";
import { DataError } from "@assesskit/runtime/errors";
import type { PciModuleConfiguration } from "@assesskit/runtime/pci";
import { container, single, type Value, type ValueDeclaration } from "@assesskit/runtime/values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EN_MESSAGES } from "../src/index.js";
import { ID_MESSAGES } from "../src/messages/id/index.js";
import type { PciFiles, PciFrameOptions } from "../src/player/pci/index.js";
import {
  buildFrameCsp,
  checkPciFrameOptions,
  checkVariable,
  createResponseDecoder,
  describeFrame,
  encodeVariable,
  isRequestedStatus,
  type PciFrameMessage,
  pciModules,
  readFrameMessage,
  responseKey,
  toJson,
} from "../src/player/pci/internal.js";

/** Matches the `DataError` of the player and the one of the runtime, which are two classes with one name. */
const DATA_ERROR = expect.objectContaining({ name: "DataError" });

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

const NS = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';

/** Reads a `qti-portable-custom-interaction` with the given attributes and content. */
function interactionOf(attributes: string, children = "<qti-interaction-markup/>") {
  const document = readAsi(
    `<qti-assessment-item ${NS} identifier="item" title="Item" time-dependent="false"><qti-item-body><qti-portable-custom-interaction response-identifier="RESPONSE" custom-interaction-type-identifier="urn:fdc:example.com:2024:pci:test" ${attributes}>${children}</qti-portable-custom-interaction></qti-item-body></qti-assessment-item>`,
  );
  const [node] = document.kind === "item" ? (document.item.body?.children ?? []) : [];
  if (node?.kind !== "portable-custom-interaction") throw new Error("The test reads a portable custom interaction.");
  return node;
}

const resolution = (paths: Readonly<Record<string, string>>, waitSeconds = 7) => ({
  waitSeconds,
  paths: new Map(Object.entries(paths)),
});

const GATE = "https://assets.example/g/t0k3n/";
const assets = (path: string): string => `${GATE}${path}`;

const INTEGER: ValueDeclaration = { cardinality: "single", baseType: "integer" };
const FILE: ValueDeclaration = { cardinality: "single", baseType: "file" };

/** The bytes of the text "pleasure.", and the base64 of them that the best practices guide gives in its example of a file. */
const PLEASURE = { bytes: new TextEncoder().encode("pleasure."), base64: "cGxlYXN1cmUu" };

/** A host that keeps files in memory: the references are `file-1`, `file-2` and so on, and the calls are recorded. */
function memoryFiles(stored: ReadonlyMap<string, Uint8Array> = new Map()) {
  const uploads: { readonly bytes: Uint8Array; readonly mimeType: string; readonly fileName: string | undefined }[] =
    [];
  const files: PciFiles = {
    read: async ({ reference }) => stored.get(reference) ?? new Uint8Array(),
    upload: async (blob, mimeType, fileName) => {
      uploads.push({ bytes: new Uint8Array(await blob.arrayBuffer()), mimeType, fileName });
      return { reference: `file-${uploads.length}`, mimeType, ...(fileName === undefined ? {} : { fileName }) };
    },
  };
  return { files, uploads };
}

describe("checkVariable", () => {
  it("accepts a value with its declaration, and NULL", () => {
    expect(() => checkVariable({ value: single("integer", 3), declaration: INTEGER })).not.toThrow();
    expect(() => checkVariable({ value: null, declaration: INTEGER })).not.toThrow();
  });

  it("rejects what is not a variable, and a value that is not of its declaration", () => {
    expect(() => checkVariable(json("null"))).toThrow("A variable must be an object with a value and a declaration");
    expect(() => checkVariable({ value: single("string", "a"), declaration: INTEGER })).toThrow(DATA_ERROR);
    expect(() => checkVariable({ value: single("integer", 1), declaration: json('{"cardinality":"many"}') })).toThrow(
      DATA_ERROR,
    );
    expect(() => checkVariable({ value: json('{"cardinality":"single"}'), declaration: INTEGER })).toThrow(DATA_ERROR);
  });
});

describe("encodeVariable", () => {
  it("writes a value as the JSON of the portable custom interaction binding", async () => {
    const { files } = memoryFiles();
    expect(await encodeVariable({ value: single("integer", 3), declaration: INTEGER }, files)).toEqual({
      base: { integer: 3 },
    });
    expect(await encodeVariable({ value: null, declaration: INTEGER }, files)).toEqual({ base: null });
    expect(
      await encodeVariable(
        {
          value: container("multiple", "integer", [3, 4]),
          declaration: { cardinality: "multiple", baseType: "integer" },
        },
        files,
      ),
    ).toEqual({ list: { integer: [3, 4] } });
  });

  it("reads the bytes of a file from the host and writes them inline as base64, as App. C.1 shows", async () => {
    const { files } = memoryFiles(new Map([["stored-1", PLEASURE.bytes]]));
    const value = single("file", { reference: "stored-1", mimeType: "text/plain", fileName: "helloworld.txt" });
    expect(await encodeVariable({ value, declaration: FILE }, files)).toEqual({
      base: { file: { data: PLEASURE.base64, mime: "text/plain", name: "helloworld.txt" } },
    });
  });

  it("reads each file of a container and of a record", async () => {
    const { files } = memoryFiles(
      new Map([
        ["a", new TextEncoder().encode("a")],
        ["b", new TextEncoder().encode("b")],
      ]),
    );
    const list = container("multiple", "file", [
      { reference: "a", mimeType: "text/plain" },
      { reference: "b", mimeType: "text/plain" },
    ]);
    expect(
      await encodeVariable({ value: list, declaration: { cardinality: "multiple", baseType: "file" } }, files),
    ).toEqual({
      list: {
        file: [
          { data: "YQ==", mime: "text/plain" },
          { data: "Yg==", mime: "text/plain" },
        ],
      },
    });
  });

  it("passes on the error of the host's storage", async () => {
    const files: PciFiles = {
      read: () => Promise.reject(new Error("The storage is down.")),
      upload: async () => ({ reference: "", mimeType: "" }),
    };
    const value = single("file", { reference: "stored-1", mimeType: "text/plain" });
    await expect(encodeVariable({ value, declaration: FILE }, files)).rejects.toThrow("The storage is down.");
  });
});

describe("responseKey", () => {
  const record: ValueDeclaration = { cardinality: "record" };

  it("gives one text for every JSON of a value, and another for another value", () => {
    expect(responseKey(null, INTEGER)).toBe(responseKey({ base: null }, INTEGER));
    expect(responseKey({ base: { integer: 3 } }, INTEGER)).not.toBe(responseKey({ base: { integer: 4 } }, INTEGER));
    expect(responseKey({ record: [{ name: "a", base: { integer: 1 } }] }, record)).not.toBe(
      responseKey({ record: [{ name: "a", base: { integer: 2 } }] }, record),
    );
  });

  it("counts a file by its type, its name and its bytes, and stores none", () => {
    const file = (data: string, name: string) => ({ base: { file: { data, mime: "text/plain", name } } });
    expect(responseKey(file(PLEASURE.base64, "a.txt"), FILE)).toBe(responseKey(file(PLEASURE.base64, "a.txt"), FILE));
    expect(responseKey(file(PLEASURE.base64, "a.txt"), FILE)).not.toBe(responseKey(file("", "a.txt"), FILE));
    expect(responseKey(file(PLEASURE.base64, "a.txt"), FILE)).not.toBe(
      responseKey(file(PLEASURE.base64, "b.txt"), FILE),
    );
  });

  it("gives undefined for JSON that is no value of the declaration", () => {
    expect(responseKey({ base: { string: "x" } }, INTEGER)).toBeUndefined();
    expect(responseKey(json("5"), INTEGER)).toBeUndefined();
  });
});

describe("createResponseDecoder", () => {
  const inline = (data: string, name = "helloworld.txt") => ({ base: { file: { data, mime: "text/plain", name } } });

  it("reads the JSON of a response as a value of the declaration", async () => {
    const decode = createResponseDecoder(memoryFiles().files);
    expect(await decode({ base: { integer: 3 } }, INTEGER)).toEqual(single("integer", 3));
    expect(await decode({ list: { integer: [3, 4] } }, { cardinality: "multiple", baseType: "integer" })).toEqual(
      container("multiple", "integer", [3, 4]),
    );
  });

  it("gives NULL for no response, for null, and for the NULL of App. C", async () => {
    const decode = createResponseDecoder(memoryFiles().files);
    expect(await decode(json("null"), INTEGER)).toBeNull();
    expect(await decode({ base: null }, INTEGER)).toBeNull();
  });

  it("stores an inline file through the host and keeps its reference", async () => {
    const { files, uploads } = memoryFiles();
    const decode = createResponseDecoder(files);
    const value = await decode(inline(PLEASURE.base64), FILE);
    expect(value).toEqual(single("file", { reference: "file-1", mimeType: "text/plain", fileName: "helloworld.txt" }));
    expect(uploads).toEqual([{ bytes: PLEASURE.bytes, mimeType: "text/plain", fileName: "helloworld.txt" }]);
  });

  it("stores a file without a name without one", async () => {
    const { files, uploads } = memoryFiles();
    await createResponseDecoder(files)({ base: { file: { data: PLEASURE.base64, mime: "text/plain" } } }, FILE);
    expect(uploads[0]?.fileName).toBeUndefined();
  });

  it("stores the files of a container in order, each with its own reference", async () => {
    const { files, uploads } = memoryFiles();
    const decode = createResponseDecoder(files);
    const value = await decode(
      {
        list: {
          file: [
            { data: "YQ==", mime: "text/plain" },
            { data: "Yg==", mime: "text/plain" },
          ],
        },
      },
      { cardinality: "multiple", baseType: "file" },
    );
    expect(value).toEqual(
      container("multiple", "file", [
        { reference: "file-1", mimeType: "text/plain" },
        { reference: "file-2", mimeType: "text/plain" },
      ]),
    );
    expect(uploads.map(({ bytes }) => new TextDecoder().decode(bytes))).toEqual(["a", "b"]);
  });

  it("stores a file that an earlier response held only once, and one that is new", async () => {
    const { files, uploads } = memoryFiles();
    const decode = createResponseDecoder(files);
    const first = await decode(inline(PLEASURE.base64), FILE);
    const again = await decode(inline(PLEASURE.base64), FILE);
    const other = await decode(inline("YQ=="), FILE);
    expect(again).toEqual(first);
    expect(uploads).toHaveLength(2);
    expect(other).toEqual(single("file", { reference: "file-2", mimeType: "text/plain", fileName: "helloworld.txt" }));
    await decode(inline(PLEASURE.base64), FILE);
    expect(uploads).toHaveLength(3);
  });

  it("stores nothing for JSON that is not of the declaration", async () => {
    const { files, uploads } = memoryFiles();
    const decode = createResponseDecoder(files);
    await expect(decode({ base: { integer: "x" } }, INTEGER)).rejects.toThrow(DATA_ERROR);
    await expect(decode({ base: { file: { data: PLEASURE.base64 } } }, FILE)).rejects.toThrow(DATA_ERROR);
    await expect(decode({ base: { string: "a" } }, FILE)).rejects.toThrow(DATA_ERROR);
    await expect(decode(json('"base"'), INTEGER)).rejects.toThrow(DATA_ERROR);
    expect(uploads).toEqual([]);
  });

  it("refuses a file whose data is not base64, before it stores anything", async () => {
    const { files, uploads } = memoryFiles();
    const decode = createResponseDecoder(files);
    await expect(decode(inline("not base64!"), FILE)).rejects.toThrow("The data of a file must be base64.");
    expect(uploads).toEqual([]);
  });

  it("refuses a host that stores a file and gives no reference", async () => {
    const files: PciFiles = { read: async () => new Uint8Array(), upload: async () => json("{}") as never };
    await expect(createResponseDecoder(files)(inline(PLEASURE.base64), FILE)).rejects.toThrow(
      "The reference of an uploaded file must be a string",
    );
  });
});

describe("pciModules", () => {
  it("locates the module of the module attribute and its dependencies under the asset prefix", () => {
    const primary = resolution({ exampleLikertScale: "modules/likert", handlebars: "modules/lib/handlebars.min" }, 15);
    expect(pciModules(interactionOf('module="exampleLikertScale"'), { primary }, assets)).toEqual({
      baseUrl: `${GATE}modules/`,
      paths: new Map([
        ["exampleLikertScale", [`${GATE}modules/likert`]],
        ["handlebars", [`${GATE}modules/lib/handlebars.min`]],
      ]),
      waitSeconds: 15,
      load: ["exampleLikertScale"],
    });
  });

  it("lists the primary location before the fallback, and leaves a location with a protocol as it is", () => {
    const modules = pciModules(
      interactionOf('module="m"'),
      {
        primary: resolution({ m: "https://cdn.example/js/m" }),
        fallback: resolution({ m: "modules/lib/m" }),
      },
      assets,
    );
    expect(modules.paths).toEqual(new Map([["m", ["https://cdn.example/js/m", `${GATE}modules/lib/m`]]]));
  });

  it("takes the base URL from the first package location of the first module, the fallback when the primary is a URL", () => {
    const modules = pciModules(
      interactionOf('module="m"'),
      { primary: resolution({ m: "https://cdn.example/js/m" }), fallback: resolution({ m: "deep/dir/m" }) },
      assets,
    );
    expect(modules.baseUrl).toBe(`${GATE}deep/dir/`);
  });

  it("takes the base URL from the configuration file when every location has a protocol", () => {
    const interaction = interactionOf(
      'module="m"',
      '<qti-interaction-modules primary-configuration="lib/config.js"/><qti-interaction-markup/>',
    );
    expect(pciModules(interaction, { primary: resolution({ m: "https://cdn.example/m" }) }, assets).baseUrl).toBe(
      `${GATE}lib/`,
    );
    expect(
      pciModules(interactionOf('module="m"'), { primary: resolution({ m: "https://cdn.example/m" }) }, assets).baseUrl,
    ).toBe(`${GATE}modules/`);
  });

  it("loads the modules of qti-interaction-modules, in document order, when there is no module attribute", () => {
    const interaction = interactionOf(
      "",
      '<qti-interaction-modules><qti-interaction-module id="eve" primary-path="modules/lib/eve.js"/><qti-interaction-module id="shading" primary-path="modules/shadingXX.js" fallback-path="modules/shading.js"/></qti-interaction-modules><qti-interaction-markup/>',
    );
    const modules = pciModules(interaction, {}, assets);
    expect(modules.load).toEqual(["eve", "shading"]);
    expect(modules.paths).toEqual(
      new Map([
        ["eve", [`${GATE}modules/lib/eve`]],
        // the extension is not part of a location
        ["shading", [`${GATE}modules/shadingXX`, `${GATE}modules/shading`]],
      ]),
    );
    expect(modules.baseUrl).toBe(`${GATE}modules/lib/`);
  });

  it("takes a location with the .js extension for the file that RequireJS would find without it", () => {
    const interaction = interactionOf(
      "",
      '<qti-interaction-modules><qti-interaction-module id="eve" primary-path="modules/lib/eve.js"/><qti-interaction-module id="shading" primary-path="https://cdn.example/shading.min.js" fallback-path="modules/shading.js?v=2"/></qti-interaction-modules><qti-interaction-markup/>',
    );
    expect(pciModules(interaction, {}, assets).paths).toEqual(
      new Map([
        ["eve", [`${GATE}modules/lib/eve`]],
        ["shading", ["https://cdn.example/shading.min", `${GATE}modules/shading.js?v=2`]],
      ]),
    );
  });

  it("waits 7 seconds when no primary configuration says otherwise, and keeps 0, which waits for ever", () => {
    expect(pciModules(interactionOf('module="m"'), { fallback: resolution({ m: "m" }) }, assets).waitSeconds).toBe(7);
    expect(pciModules(interactionOf('module="m"'), { primary: resolution({ m: "m" }, 0) }, assets).waitSeconds).toBe(0);
  });

  it("refuses an interaction that names no module, and a module that has no location", () => {
    expect(() => pciModules(interactionOf(""), { primary: resolution({ m: "m" }) }, assets)).toThrow(
      "The interaction names no module to load",
    );
    expect(() => pciModules(interactionOf('module="m"'), { primary: resolution({ other: "o" }) }, assets)).toThrow(
      'The module "m" has no location',
    );
  });

  it("refuses a location in the package on an origin that the frame loads no scripts from, and none of another kind", () => {
    const configuration: PciModuleConfiguration = {
      primary: resolution({ m: "modules/m", cdn: "https://cdn.example/cdn" }),
    };
    const interaction = interactionOf('module="m"');
    expect(() => pciModules(interaction, configuration, assets, ["https://other.example"])).toThrow(
      `The URL "${GATE}modules/m" of a file of the package is on the origin https://assets.example, which the frame does not load scripts from (https://other.example).`,
    );
    expect(pciModules(interaction, configuration, assets, ["https://assets.example"]).load).toEqual(["m"]);
    // A location with a protocol is the frame's policy to allow or refuse, when it loads.
    const external = interactionOf('module="cdn"');
    expect(() => pciModules(external, configuration, assets, ["https://assets.example"])).not.toThrow();
  });

  it("refuses a relative URL of the package when there is no page to resolve it against", () => {
    const configuration: PciModuleConfiguration = { primary: resolution({ m: "modules/m" }) };
    expect(() => pciModules(interactionOf('module="m"'), configuration, (path) => `/package/${path}`)).toThrow(
      'The option assets gave the URL "/package/modules/m", which is relative, and there is no page whose address could resolve it.',
    );
  });

  it("refuses arguments of other types", () => {
    const configuration: PciModuleConfiguration = { primary: resolution({ m: "m" }) };
    expect(() => pciModules(json("null") as never, configuration, assets)).toThrow(DATA_ERROR);
    expect(() => pciModules(interactionOf('module="m"'), json("null") as never, assets)).toThrow(DATA_ERROR);
  });
});

/** The smallest options that `checkPciFrameOptions` accepts. */
const MINIMAL: PciFrameOptions = {
  staticUrl: "https://assets.example/static/",
  messages: EN_MESSAGES,
  language: "en",
  interaction: interactionOf('module="tap" data-toggle="true"'),
  configuration: { primary: resolution({ tap: "modules/tap" }) },
  assets,
  prompt: null,
  markup: "",
  stylesheets: [],
  status: "interacting",
  response: { value: single("integer", 0), declaration: INTEGER },
  files: memoryFiles().files,
  onEvent: () => undefined,
};

/** Calls `checkPciFrameOptions` with the options changed, as plain JavaScript passes them. */
const check = (changes: Readonly<Record<string, unknown>>): void => checkPciFrameOptions({ ...MINIMAL, ...changes });

describe("checkPciFrameOptions", () => {
  it("accepts the smallest options, and the options with every optional one", () => {
    expect(() => checkPciFrameOptions(MINIMAL)).not.toThrow();
    expect(() =>
      check({
        origins: ["https://cdn.example", "http://localhost:8080"],
        templateVariables: new Map([["X", { value: single("integer", 1), declaration: INTEGER }]]),
        contextVariables: new Map(),
        state: "{}",
        prompt: "Tap the picture.",
      }),
    ).not.toThrow();
  });

  it("rejects options that are not an object, and an option that is not known", () => {
    for (const text of ["null", "[]", '"x"']) {
      expect(() => checkPciFrameOptions(json(text)), text).toThrow(/^The options must be an object, found /);
    }
    expect(() => check({ origin: "https://cdn.example" })).toThrow(
      /^The options has the properties "staticUrl", .* found "origin"\.$/,
    );
    expect(() => check({ modules: {} })).toThrow(/found "modules"\.$/);
  });

  it("rejects a static URL that is not an absolute http URL ending in a slash", () => {
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
  });

  it("rejects an origin that is more than a scheme, a host and a port", () => {
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
    expect(() => check({ origins: json("null") })).toThrow("The option origins must be an array, found null.");
  });

  it("rejects an interaction that is not a portable custom interaction", () => {
    expect(() => check({ interaction: json("null") })).toThrow("The option interaction must be an object, found null.");
    expect(() => check({ interaction: json('{"kind":"choice-interaction"}') })).toThrow(
      'The option interaction must be a qti-portable-custom-interaction, found the kind "choice-interaction".',
    );
    expect(() => check({ interaction: json('{"kind":"portable-custom-interaction"}') })).toThrow(
      "The custom-interaction-type-identifier of the interaction must be a non-empty string",
    );
    expect(() => check({ configuration: json("null") })).toThrow(
      "The option configuration must be an object, found null.",
    );
    expect(() => check({ assets: json("null") })).toThrow("The option assets must be a function, found null.");
  });

  it("rejects the variables, the state and the status of the wrong type", () => {
    expect(() => check({ response: json("null") })).toThrow(
      "A variable must be an object with a value and a declaration",
    );
    expect(() => check({ response: { value: single("string", "a"), declaration: INTEGER } })).toThrow(DATA_ERROR);
    expect(() => check({ templateVariables: json("{}") })).toThrow(
      "The option templateVariables must be a Map, found an object.",
    );
    expect(() => check({ templateVariables: json("null") })).toThrow("must be a Map, found null.");
    expect(() => check({ contextVariables: new Map([["", { value: null, declaration: INTEGER }]]) })).toThrow(
      "A name in The option contextVariables",
    );
    expect(() => check({ contextVariables: new Map([["X", json("5")]]) })).toThrow("A variable must be an object");
    expect(() => check({ state: json("5") })).toThrow("The option state must be a string, found 5.");
    expect(() => check({ state: json("null") })).not.toThrow();
    expect(() => check({ status: "paused" })).toThrow(
      'The option status must be "interacting", "suspended", "closed", "solution" or "review", found "paused".',
    );
  });

  it("rejects a prompt, a language, markup, stylesheets, messages, files and a listener of the wrong type", () => {
    expect(() => check({ prompt: json("5") })).toThrow("The option prompt must be a string, found 5.");
    expect(() => check({ prompt: undefined })).toThrow("The option prompt must be a string, found undefined.");
    expect(() => check({ language: "" })).toThrow("The option language must be a non-empty string");
    expect(() => check({ markup: json("null") })).toThrow("The option markup must be a string, found null.");
    expect(() => check({ stylesheets: ["item.css"] })).toThrow(
      /^A stylesheet of the option stylesheets must be an absolute/,
    );
    expect(() => check({ messages: json("null") })).toThrow("The option messages must be an object, found null.");
    expect(() => check({ messages: {} })).toThrow("The message interactiveQuestion must be a non-empty string");
    expect(() => check({ files: json("null") })).toThrow("The option files must be an object");
    expect(() => check({ files: { read: () => 1 } })).toThrow(
      "The function upload of the option files must be a function",
    );
    expect(() => check({ onEvent: json("null") })).toThrow("The option onEvent must be a function, found null.");
  });
});

describe("describeFrame", () => {
  it("gives the interaction its identifiers, class, properties and modules, from the interaction itself", async () => {
    const interaction = interactionOf(
      'module="tap" class="hmh-tap-border-rounded qti-orientation-horizontal" data-toggle="true" data-tap-message="Tap to reveal"',
    );
    const { prepare } = describeFrame({ ...MINIMAL, interaction });
    expect(await prepare()).toMatchObject({
      type: "start",
      language: "en",
      className: "hmh-tap-border-rounded qti-orientation-horizontal",
      typeIdentifier: "urn:fdc:example.com:2024:pci:test",
      responseIdentifier: "RESPONSE",
      status: "interacting",
      properties: new Map([
        ["toggle", "true"],
        ["tapMessage", "Tap to reveal"],
      ]),
      modules: { baseUrl: `${GATE}modules/`, load: ["tap"], waitSeconds: 7 },
      state: null,
      origins: [],
      markup: "",
    });
  });

  it("writes the response, the template variables and the context variables as JSON", async () => {
    const { prepare } = describeFrame({
      ...MINIMAL,
      response: { value: single("integer", 2), declaration: INTEGER },
      templateVariables: new Map([["X", { value: single("integer", 3), declaration: INTEGER }]]),
      contextVariables: new Map([
        [
          "LIMITS",
          {
            value: container("multiple", "float", [1.5, 2.5]),
            declaration: { cardinality: "multiple", baseType: "float" },
          },
        ],
        ["NOTHING", { value: null, declaration: INTEGER }],
      ]),
      state: '{"count":2}',
    });
    expect(await prepare()).toMatchObject({
      boundTo: { base: { integer: 2 } },
      templateVariables: new Map([["X", { base: { integer: 3 } }]]),
      contextVariables: new Map([
        ["LIMITS", { list: { float: [1.5, 2.5] } }],
        ["NOTHING", { base: null }],
      ]),
      state: '{"count":2}',
    });
  });

  it("reads the bytes of the files that go to the interaction", async () => {
    const { files } = memoryFiles(new Map([["stored-1", PLEASURE.bytes]]));
    const value: Value = single("file", { reference: "stored-1", mimeType: "text/plain", fileName: "helloworld.txt" });
    const { prepare } = describeFrame({ ...MINIMAL, response: { value, declaration: FILE }, files });
    expect((await prepare()).boundTo).toEqual({
      base: { file: { data: PLEASURE.base64, mime: "text/plain", name: "helloworld.txt" } },
    });
  });

  it("puts player.css from the static URL before the stylesheets of the item", async () => {
    const { prepare } = describeFrame({ ...MINIMAL, stylesheets: [`${GATE}styles/item.css`] });
    expect((await prepare()).stylesheets).toEqual([
      "https://assets.example/static/player.css",
      `${GATE}styles/item.css`,
    ]);
  });

  it("names the frame from the prompt, with its white space collapsed, else by the message", () => {
    expect(describeFrame({ ...MINIMAL, prompt: "  Which\n  is   larger? " }).title).toBe("Which is larger?");
    expect(describeFrame({ ...MINIMAL, prompt: null }).title).toBe("Interactive question");
    expect(describeFrame({ ...MINIMAL, prompt: " \n\t " }).title).toBe("Interactive question");
    expect(describeFrame({ ...MINIMAL, prompt: "", messages: ID_MESSAGES }).title).toBe("Soal interaktif");
  });

  it("refuses an interaction whose modules cannot load", () => {
    expect(() => describeFrame({ ...MINIMAL, interaction: interactionOf("") })).toThrow("names no module to load");
  });
});

describe("isRequestedStatus", () => {
  it("accepts the statuses that the best practices guide lists for ondone and no other", () => {
    for (const status of ["interacting", "closed", "solution", "review"]) expect(isRequestedStatus(status)).toBe(true);
    for (const status of ["suspended", "", "Closed", json("null"), json("1")])
      expect(isRequestedStatus(status)).toBe(false);
  });
});

describe("buildFrameCsp", () => {
  const origin = "https://assets.example";
  const policy = directives(buildFrameCsp(origin, []));

  it("allows nothing by default, and scripts only from the origin of the frame", () => {
    expect(policy.get("default-src")).toEqual(["'none'"]);
    expect(policy.get("script-src")).toEqual([origin]);
  });

  it("allows inline styles in the frame, and inline images, media and fonts, which reach no network", () => {
    expect(policy.get("style-src")).toEqual([origin, "'unsafe-inline'"]);
    expect(policy.get("img-src")).toEqual([origin, "data:"]);
    expect(policy.get("media-src")).toEqual([origin, "data:"]);
    expect(policy.get("font-src")).toEqual([origin, "data:"]);
  });

  it("forbids connections, frames, forms and a base element", () => {
    for (const name of ["connect-src", "frame-src", "form-action", "base-uri"]) {
      expect(policy.get(name), name).toEqual(["'none'"]);
    }
  });

  it("allows no inline script and no evaluation of strings", () => {
    const sources = [...policy.entries()].filter(([name]) => name !== "style-src").flatMap(([, list]) => list);
    expect(sources).not.toContain("'unsafe-inline'");
    expect(sources).not.toContain("'unsafe-eval'");
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("adds the allowed origins to the scripts, styles, images, media and fonts", () => {
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
  it("turns undefined, which getResponse gives for no response, into null", () => {
    expect(toJson(undefined)).toBeNull();
  });

  it("keeps JSON, and loses what JSON loses", () => {
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

  it("reads each message that the frame sends", () => {
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
    expect(read('{"type":"snapshot","id":2,"flushed":{"response":{"base":{"integer":1}},"state":"s"}}')).toEqual({
      type: "snapshot",
      id: 2,
      flushed: { response: { base: { integer: 1 } }, state: "s" },
    });
    expect(read('{"type":"snapshot","id":0,"flushed":null}')).toEqual({ type: "snapshot", id: 0, flushed: null });
    expect(read('{"type":"failed","reason":"register"}')).toEqual({ type: "failed", reason: "register" });
  });

  it("takes a change with no validity, and a response of undefined, as a structured clone delivers them", () => {
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

  it("rejects what is not an object, and an object of another type", () => {
    for (const text of ["null", "[]", '"loaded"', "5", "true"]) {
      expect(() => read(text), text).toThrow(/^A message from the frame must be an object, found /);
    }
    expect(() => read('{"type":"navigate"}')).toThrow(
      /^A message from the frame has the type "loaded", .* found "navigate"\.$/,
    );
    expect(() => read("{}")).toThrow("found undefined.");
  });

  it("rejects a state that is not a string", () => {
    expect(() => read('{"type":"ready","state":5}')).toThrow(
      new DataError("The state of an interaction must be a string, found 5."),
    );
    expect(() => read('{"type":"changed","response":null}')).toThrow("found undefined.");
    expect(() => read('{"type":"done","response":null,"state":null,"status":"closed"}')).toThrow("found null.");
    expect(() => read('{"type":"completed","flushed":{"response":null}}')).toThrow("The state of an interaction");
  });

  it("rejects a height that is not a non-negative integer", () => {
    for (const text of ['"9"', "-1", "1.5", "null", "[]"]) {
      expect(() => read(`{"type":"height","height":${text}}`), text).toThrow(/^The height of the frame must be/);
    }
    expect(() => readFrameMessage({ type: "height", height: Number.POSITIVE_INFINITY })).toThrow(DataError);
    expect(() => readFrameMessage({ type: "height", height: Number.NaN })).toThrow(DataError);
  });

  it("rejects a status that ondone does not know, a validity that is not a boolean, and a failure that is not listed", () => {
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
    expect(() => read('{"type":"snapshot","id":"1","flushed":null}')).toThrow("The identifier of a snapshot request");
    expect(() => read('{"type":"snapshot","id":1,"flushed":{"state":5}}')).toThrow("The state of an interaction");
  });

  it("rejects a response that has a cycle", () => {
    const response: Record<string, unknown> = {};
    response.self = response;
    expect(() => readFrameMessage({ type: "done", response, state: "s", status: "closed" })).toThrow(DataError);
  });
});

describe("properties", () => {
  it("gives a message of a known type or throws a DataError, for any value", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        try {
          expect([
            "loaded",
            "ready",
            "changed",
            "done",
            "height",
            "validity",
            "snapshot",
            "completed",
            "failed",
          ]).toContain(readFrameMessage(value).type);
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
      }),
    );
  });

  it("reads every height message that has a non-negative safe integer", () => {
    fc.assert(
      fc.property(fc.nat(), (height) => {
        expect(readFrameMessage({ type: "height", height })).toEqual({ type: "height", height });
      }),
    );
  });

  it("gives a response that is JSON, whatever the frame sent", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (response) => {
        const message = readFrameMessage({ type: "changed", response, state: "s", valid: true });
        expect(message.type === "changed" && JSON.stringify(message.response)).toBe(JSON.stringify(response));
      }),
    );
  });

  it("gives back the value that a response was written from, files included", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ maxLength: 64 }),
        fc.constantFrom("text/plain", "image/png"),
        async (bytes, mimeType) => {
          const stored = new Map([["stored-1", bytes]]);
          const value = single("file", { reference: "stored-1", mimeType, fileName: "f.bin" });
          const written = await encodeVariable({ value, declaration: FILE }, memoryFiles(stored).files);
          const { files, uploads } = memoryFiles();
          const read = await createResponseDecoder(files)(written, FILE);
          expect(read).toEqual(single("file", { reference: "file-1", mimeType, fileName: "f.bin" }));
          expect(uploads[0]?.bytes).toEqual(bytes);
        },
      ),
    );
  });
});
