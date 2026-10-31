// cspell:ignore Approximative Likert handlebarsv
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ASI_NAMESPACE,
  type BaseType,
  type Cardinality,
  checkPortableInteraction,
  container,
  DataError,
  DEFAULT_WAIT_SECONDS,
  decodePciValue,
  encodePciValue,
  isPackageRelative,
  type ModuleResolution,
  moduleConfigurationPaths,
  type PciFileLoader,
  type PciFileStore,
  type PciModuleConfiguration,
  type PortableCustomInteraction,
  parseModuleResolution,
  pciProperties,
  readAsi,
  record,
  resolvePciModules,
  type SingleValue,
  single,
  type Value,
  type ValueDeclaration,
} from "../src/index.js";
import { baseType, recordValue, valueArbitrary } from "./arbitraries/values.js";
import { fuzzJson } from "./fuzz.js";

// Helpers ---------------------------------------------------------------------------------------------------------------

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

const NS = `xmlns="${ASI_NAMESPACE}"`;

/** Reads the portable custom interaction of an item whose body is the given markup, with the given declarations. */
function interactionOf(attributes: string, children = "<qti-interaction-markup/>"): PortableCustomInteraction {
  const document = readAsi(
    `<qti-assessment-item ${NS} identifier="item" title="Item" time-dependent="false"><qti-item-body><qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:fdc:example.com:2024:pci:test" ${attributes}>${children}</qti-portable-custom-interaction></qti-item-body></qti-assessment-item>`,
  );
  const [node] = document.kind === "item" ? (document.item.body?.children ?? []) : [];
  if (node?.kind !== "portable-custom-interaction") throw new Error("The test reads a portable custom interaction.");
  return node;
}

const resolution = (paths: Record<string, string>, waitSeconds = DEFAULT_WAIT_SECONDS): ModuleResolution => ({
  waitSeconds,
  paths: new Map(Object.entries(paths)),
});

/** A host that keeps the bytes of a file as the base64 text it was given, and uses that text as the reference. */
const HOST: PciFileLoader & PciFileStore = {
  load: (reference) => reference.slice("stored:".length),
  store: (data) => `stored:${data}`,
};

// biome-ignore lint/suspicious/noApproximativeNumericConstant: the example of BPIG Appendix C.2 has this value.
const PI_TO_SEVEN_PLACES = 3.1415926;

function str(value: string): SingleValue {
  const built = single("string", value);
  if (built === null) throw new Error("The test builds an empty string.");
  return built;
}

const file = (data: string, mimeType: string, fileName?: string): SingleValue =>
  single("file", { reference: `stored:${data}`, mimeType, ...(fileName === undefined ? {} : { fileName }) });

describe("encodePciValue and decodePciValue", () => {
  const Single: Cardinality = "single";

  /** The examples of BPIG Appendix C.1 to C.3 with the values they stand for, apart from the duration and the file. */
  const Examples: readonly {
    readonly json: unknown;
    readonly cardinality: Cardinality;
    readonly baseType?: BaseType;
    readonly value: Value | null;
  }[] = [
    { json: { base: null }, cardinality: Single, baseType: "string", value: null },
    { json: { base: { boolean: true } }, cardinality: Single, baseType: "boolean", value: single("boolean", true) },
    { json: { base: { integer: 123 } }, cardinality: Single, baseType: "integer", value: single("integer", 123) },
    { json: { base: { float: 23.23 } }, cardinality: Single, baseType: "float", value: single("float", 23.23) },
    {
      json: { base: { string: "string" } },
      cardinality: Single,
      baseType: "string",
      value: str("string"),
    },
    { json: { base: { point: [10, 20] } }, cardinality: Single, baseType: "point", value: single("point", [10, 20]) },
    { json: { base: { pair: ["A", "B"] } }, cardinality: Single, baseType: "pair", value: single("pair", ["A", "B"]) },
    {
      json: { base: { directedPair: ["a", "b"] } },
      cardinality: Single,
      baseType: "directedPair",
      value: single("directedPair", ["a", "b"]),
    },
    {
      json: { base: { uri: "file:///somewhere.txt" } },
      cardinality: Single,
      baseType: "uri",
      value: single("uri", "file:///somewhere.txt"),
    },
    {
      json: { base: { identifier: "_identifier" } },
      cardinality: Single,
      baseType: "identifier",
      value: single("identifier", "_identifier"),
    },
    { json: { list: null }, cardinality: "multiple", baseType: "boolean", value: null },
    {
      json: { list: { boolean: [true, false, true, true] } },
      cardinality: "multiple",
      baseType: "boolean",
      value: container("multiple", "boolean", [true, false, true, true]),
    },
    {
      json: { list: { integer: [2, 3, 5, 7, 11, 13] } },
      cardinality: "ordered",
      baseType: "integer",
      value: container("ordered", "integer", [2, 3, 5, 7, 11, 13]),
    },
    {
      json: { list: { float: [PI_TO_SEVEN_PLACES, 12.34, 98.76] } },
      cardinality: "multiple",
      baseType: "float",
      value: container("multiple", "float", [PI_TO_SEVEN_PLACES, 12.34, 98.76]),
    },
    {
      json: { list: { string: ["Another", "And Another"] } },
      cardinality: "multiple",
      baseType: "string",
      value: container("multiple", "string", ["Another", "And Another"]),
    },
    {
      json: {
        list: {
          point: [
            [123, 456],
            [640, 480],
          ],
        },
      },
      cardinality: "multiple",
      baseType: "point",
      value: container("multiple", "point", [
        [123, 456],
        [640, 480],
      ]),
    },
    {
      json: {
        list: {
          pair: [
            ["A", "B"],
            ["D", "C"],
          ],
        },
      },
      cardinality: "multiple",
      baseType: "pair",
      value: container("multiple", "pair", [
        ["A", "B"],
        ["D", "C"],
      ]),
    },
    {
      json: {
        list: {
          directedPair: [
            ["A", "B"],
            ["C", "D"],
          ],
        },
      },
      cardinality: "ordered",
      baseType: "directedPair",
      value: container("ordered", "directedPair", [
        ["A", "B"],
        ["C", "D"],
      ]),
    },
    {
      json: { list: { uri: ["file:///aFile.txt", "file:///abc.txt"] } },
      cardinality: "multiple",
      baseType: "uri",
      value: container("multiple", "uri", ["file:///aFile.txt", "file:///abc.txt"]),
    },
    {
      json: { list: { identifier: ["_id1", "id2", "ID3"] } },
      cardinality: "multiple",
      baseType: "identifier",
      value: container("multiple", "identifier", ["_id1", "id2", "ID3"]),
    },
    { json: { record: null }, cardinality: "record", value: null },
    {
      json: {
        record: [
          { name: "rock", base: { boolean: true } },
          { name: "paper", base: { string: "Four score and seven years ago..." } },
          { name: "scissors", base: { integer: 4 } },
        ],
      },
      cardinality: "record",
      value: record([
        ["rock", single("boolean", true)],
        ["paper", str("Four score and seven years ago...")],
        ["scissors", single("integer", 4)],
      ]),
    },
  ];

  it.each(Examples)("[J1][J2][J3] reads and writes the example %j of BPIG Appendix C", (example) => {
    const declaration = {
      cardinality: example.cardinality,
      ...(example.baseType === undefined ? {} : { baseType: example.baseType }),
    };
    expect(decodePciValue(example.json, declaration, HOST)).toEqual(example.value);
    expect(encodePciValue(example.value, declaration, HOST)).toEqual(example.json);
  });

  it("[J1] reads intOrIdentifier as an integer for a number and as an identifier for a string (G38)", () => {
    expect(
      decodePciValue({ base: { intOrIdentifier: 123456 } }, { cardinality: "single", baseType: "integer" }, HOST),
    ).toEqual(single("integer", 123456));
    expect(
      decodePciValue({ base: { intOrIdentifier: "_id" } }, { cardinality: "single", baseType: "identifier" }, HOST),
    ).toEqual(single("identifier", "_id"));
    expect(
      decodePciValue(
        {
          record: [
            { name: "a", base: { intOrIdentifier: 2 } },
            { name: "b", base: { intOrIdentifier: "_id" } },
          ],
        },
        { cardinality: "record" },
        HOST,
      ),
    ).toEqual(
      record([
        ["a", single("integer", 2)],
        ["b", single("identifier", "_id")],
      ]),
    );
  });

  it("[J1] writes a duration as PT<seconds>S and reads it back, and refuses years and months (G14)", () => {
    const declaration = { cardinality: "single", baseType: "duration" } as const;
    expect(encodePciValue(single("duration", 90.5), declaration, HOST)).toEqual({ base: { duration: "PT90.5S" } });
    expect(decodePciValue({ base: { duration: "PT1H30M" } }, declaration, HOST)).toEqual(single("duration", 5400));
    expect(() => decodePciValue({ base: { duration: "P10Y3M20DT4H30M25S" } }, declaration, HOST)).toThrow(DataError);
    expect(() =>
      decodePciValue({ list: { duration: ["P1M"] } }, { cardinality: "multiple", baseType: "duration" }, HOST),
    ).toThrow(DataError);
  });

  it("[J3] leaves out a field of a record that is NULL (G37)", () => {
    expect(
      decodePciValue(
        {
          record: [
            { name: "foo", base: null },
            { name: "bar", base: { integer: 1 } },
          ],
        },
        { cardinality: "record" },
        HOST,
      ),
    ).toEqual(record([["bar", single("integer", 1)]]));
    expect(decodePciValue({ record: [{ name: "foo", base: null }] }, { cardinality: "record" }, HOST)).toBeNull();
  });

  describe("files", () => {
    it("[J1] stores the file of the JSON through the host and keeps its reference, as in the example of Appendix C.1", () => {
      const calls: unknown[][] = [];
      const files: PciFileStore = {
        store: (...call) => {
          calls.push(call);
          return "file-1";
        },
      };
      const value = decodePciValue(
        { base: { file: { data: "cGxlYXN1cmUu", mime: "text/plain", name: "helloworld.txt" } } },
        { cardinality: "single", baseType: "file" },
        files,
      );
      expect(calls).toEqual([["cGxlYXN1cmUu", "text/plain", "helloworld.txt"]]);
      expect(value).toEqual(
        single("file", { reference: "file-1", mimeType: "text/plain", fileName: "helloworld.txt" }),
      );
    });

    it("[J1] loads the bytes of a file value from the host and writes them inline, with the name only when there is one", () => {
      const loaded: string[] = [];
      const files: PciFileLoader = {
        load: (reference) => {
          loaded.push(reference);
          return "cGxlYXN1cmUu";
        },
      };
      const named = single("file", { reference: "file-1", mimeType: "text/plain", fileName: "helloworld.txt" });
      expect(encodePciValue(named, { cardinality: "single", baseType: "file" }, files)).toEqual({
        base: { file: { data: "cGxlYXN1cmUu", mime: "text/plain", name: "helloworld.txt" } },
      });
      expect(
        encodePciValue(
          single("file", { reference: "file-2", mimeType: "text/plain" }),
          { cardinality: "single", baseType: "file" },
          files,
        ),
      ).toEqual({ base: { file: { data: "cGxlYXN1cmUu", mime: "text/plain" } } });
      expect(loaded).toEqual(["file-1", "file-2"]);
    });

    it("[J2][J3] handles the files of a list and of the fields of a record, once each", () => {
      const list = container("multiple", "file", [
        { reference: "stored:AA==", mimeType: "image/png" },
        { reference: "stored:Ag==", mimeType: "image/png", fileName: "b.png" },
      ]);
      const json = encodePciValue(list, { cardinality: "multiple", baseType: "file" }, HOST);
      expect(json).toEqual({
        list: {
          file: [
            { data: "AA==", mime: "image/png" },
            { data: "Ag==", mime: "image/png", name: "b.png" },
          ],
        },
      });
      expect(decodePciValue(json, { cardinality: "multiple", baseType: "file" }, HOST)).toEqual(list);
      const fields = record([
        ["upload", file("AA==", "image/png")],
        ["note", str("x")],
      ]);
      const recordJson = encodePciValue(fields, { cardinality: "record" }, HOST);
      expect(recordJson).toEqual({
        record: [
          { name: "upload", base: { file: { data: "AA==", mime: "image/png" } } },
          { name: "note", base: { string: "x" } },
        ],
      });
      expect(decodePciValue(recordJson, { cardinality: "record" }, HOST)).toEqual(fields);
    });

    it("[J1] does not call the host for a value without a file", () => {
      const never = {
        load: () => {
          throw new Error("The host is not to be called.");
        },
        store: () => {
          throw new Error("The host is not to be called.");
        },
      };
      const declaration = { cardinality: "single", baseType: "string" } as const;
      expect(decodePciValue(encodePciValue(str("a"), declaration, never), declaration, never)).toEqual(str("a"));
    });

    it("[J1] refuses a file that is not {data, mime, name} with strings, and a host that answers with anything but a string", () => {
      const declaration = { cardinality: "single", baseType: "file" } as const;
      const decode = (file: string): Value | null =>
        decodePciValue(json(`{"base": {"file": ${file}}}`), declaration, HOST);
      expect(() => decode('{"mime": "text/plain"}')).toThrow('A file is invalid: missing the property "data".');
      expect(() => decode('{"data": 1, "mime": "text/plain"}')).toThrow(DataError);
      expect(() => decode('{"data": "AA==", "mime": 1}')).toThrow(DataError);
      expect(() => decode('{"data": "AA==", "mime": "text/plain", "name": 1}')).toThrow(DataError);
      expect(() => decode('{"data": "AA==", "mime": "text/plain", "extra": true}')).toThrow(
        'A file is invalid: unexpected property "extra".',
      );
      expect(() => decode('{"reference": "f1", "mime": "text/plain"}')).toThrow(DataError);
      expect(() => decode('"AA=="')).toThrow(DataError);
      const badStore = json<PciFileStore>('{"store": 1}');
      expect(() => decodePciValue({ base: { file: { data: "AA==", mime: "a/b" } } }, declaration, badStore)).toThrow(
        DataError,
      );
      const wrongReference: PciFileStore = { store: () => json("1") };
      expect(() =>
        decodePciValue({ base: { file: { data: "AA==", mime: "a/b" } } }, declaration, wrongReference),
      ).toThrow("The reference that the function store returns must be a string, found 1.");
      const wrongData: PciFileLoader = { load: () => json("1") };
      expect(() => encodePciValue(file("AA==", "a/b"), declaration, wrongData)).toThrow(DataError);
    });
  });

  it("[J1] refuses JSON that is not the JSON of a value of the declaration, as fromJsonValue does", () => {
    const declaration = { cardinality: "single", baseType: "integer" } as const;
    for (const text of [
      "null",
      '"x"',
      "[]",
      "{}",
      '{"base": 1}',
      '{"list": null}',
      '{"base": {"integer": 1}, "list": null}',
    ]) {
      expect(() => decodePciValue(json(text), declaration, HOST)).toThrow(DataError);
    }
  });

  it("[J1] refuses arguments of the wrong type", () => {
    const declaration = { cardinality: "single", baseType: "string" } as const;
    expect(() => encodePciValue(str("a"), declaration, json("null"))).toThrow(
      "The files must be an object with a function load, found null.",
    );
    expect(() => encodePciValue(str("a"), declaration, json("{}"))).toThrow(DataError);
    expect(() => decodePciValue({ base: null }, declaration, json("null"))).toThrow(DataError);
    expect(() => decodePciValue({ base: null }, declaration, json("{}"))).toThrow(DataError);
    expect(() => encodePciValue(str("a"), json("null"), HOST)).toThrow(DataError);
    expect(() => encodePciValue(single("integer", 1), declaration, HOST)).toThrow(DataError);
    expect(() => encodePciValue(json('{"cardinality": "x"}'), declaration, HOST)).toThrow(DataError);
  });

  it("[J1][J2][J3][P] reads back what it writes, for every cardinality and base type, files included", () => {
    const declared = fc.oneof(
      fc
        .tuple(fc.constantFrom<"single" | "multiple" | "ordered">("single", "multiple", "ordered"), baseType)
        .chain(([cardinality, type]) =>
          valueArbitrary(cardinality, type).map((value) => ({ value, declaration: { cardinality, baseType: type } })),
        ),
      recordValue.map((value) => ({ value, declaration: { cardinality: "record" as const } })),
    );
    fc.assert(
      fc.property(declared, ({ value, declaration }) => {
        const written = encodePciValue(value, declaration, {
          // The generated references are file names: stand in for the bytes with their base64 text.
          load: (reference) => btoa(reference),
        });
        const read = decodePciValue(written, declaration, { store: (data) => atob(data) });
        expect(read).toEqual(value);
      }),
    );
  });

  it("[J1] reads or refuses arbitrary JSON from a module with a DataError, and nothing else", () => {
    const files = { store: () => "reference" };
    const declarations: readonly [ValueDeclaration, unknown][] = [
      [{ cardinality: "single", baseType: "integer" }, { base: { integer: 1 } }],
      [{ cardinality: "single", baseType: "file" }, { base: { file: { data: "AA==", mime: "text/plain" } } }],
    ];
    for (const [declaration, example] of declarations) {
      fuzzJson((json) => decodePciValue(json, declaration, files), [example]);
    }
  });
});

describe("parseModuleResolution", () => {
  it("[J4] reads the example of Appendix D: waitSeconds and the paths in the order of the file", () => {
    const parsed = parseModuleResolution(
      '{ "waitSeconds": 15, "paths": { "graph": "https://example.com/js/modules/graph1.01/graph", "foo": "https://foobar.com/foo/bar1.2/foo" } }',
    );
    expect(parsed.waitSeconds).toBe(15);
    expect([...parsed.paths]).toEqual([
      ["graph", "https://example.com/js/modules/graph1.01/graph"],
      ["foo", "https://foobar.com/foo/bar1.2/foo"],
    ]);
  });

  it("[J4] waits 7 seconds when the file does not say, and 0 stays 0, which is no timeout", () => {
    expect(DEFAULT_WAIT_SECONDS).toBe(7);
    expect(parseModuleResolution('{"paths": {"a": "modules/a"}}').waitSeconds).toBe(7);
    expect(parseModuleResolution('{"waitSeconds": 0, "paths": {}}').waitSeconds).toBe(0);
    expect(parseModuleResolution("{}")).toEqual({ waitSeconds: 7, paths: new Map() });
  });

  it("[J4] ignores properties besides waitSeconds and paths, and keeps a module id such as __proto__ as data", () => {
    const parsed = parseModuleResolution('{"baseUrl": "x", "paths": {"__proto__": "modules/p", "a": "modules/a"}}');
    expect([...parsed.paths]).toEqual([
      ["__proto__", "modules/p"],
      ["a", "modules/a"],
    ]);
  });

  it("[J4] refuses text that is not the file: not JSON, not an object, a bad waitSeconds, a path that is not a string", () => {
    expect(() => parseModuleResolution("{")).toThrow("The module resolution file must be JSON: ");
    expect(() => parseModuleResolution("[]")).toThrow(
      "The module resolution file is invalid: expected an object, found an array.",
    );
    expect(() => parseModuleResolution('{"waitSeconds": -1}')).toThrow(
      "The module resolution file is invalid at waitSeconds: expected a value of at least 0, found -1.",
    );
    expect(() => parseModuleResolution('{"waitSeconds": "7"}')).toThrow(DataError);
    expect(() => parseModuleResolution('{"waitSeconds": null}')).toThrow(DataError);
    expect(() => parseModuleResolution('{"paths": []}')).toThrow(DataError);
    expect(() => parseModuleResolution('{"paths": {"a": 1}}')).toThrow(
      'The module resolution file is invalid at paths: the property "a" is invalid: expected a string, found 1.',
    );
    expect(() => parseModuleResolution('{"paths": {"a": ""}}')).toThrow(DataError);
    expect(() => parseModuleResolution(json("1"))).toThrow(DataError);
  });

  it("[J4] reads or refuses arbitrary JSON text with a DataError, and nothing else", () => {
    fuzzJson(
      (json) => parseModuleResolution(JSON.stringify(json)),
      [{ waitSeconds: 15, paths: { graph: "https://example.com/js/graph", foo: "foo" } }, {}],
    );
  });
});

describe("isPackageRelative", () => {
  it("[J4] takes a location with a protocol for a URL and any other for a path in the package", () => {
    for (const location of ["modules/likert", "./likert", "../likert", "likert", "modules/lib/x.min"]) {
      expect(isPackageRelative(location)).toBe(true);
    }
    for (const location of [
      "https://example.com/x",
      "HTTP://example.com/x",
      "//cdn.example.com/x",
      "data:text/javascript,1",
      "file:///x",
      "C:\\x",
    ]) {
      expect(isPackageRelative(location)).toBe(false);
    }
  });
});

describe("moduleConfigurationPaths", () => {
  it("[J5] reads modules/module_resolution.js and modules/fallback_module_resolution.js by default", () => {
    expect(moduleConfigurationPaths(interactionOf('module="m"'))).toEqual({
      primary: "modules/module_resolution.js",
      fallback: "modules/fallback_module_resolution.js",
    });
    expect(
      moduleConfigurationPaths(
        interactionOf(
          "",
          '<qti-interaction-modules><qti-interaction-module id="m" primary-path="a"/></qti-interaction-modules><qti-interaction-markup/>',
        ),
      ),
    ).toEqual({ primary: "modules/module_resolution.js", fallback: "modules/fallback_module_resolution.js" });
  });

  it("[J5] takes the files that qti-interaction-modules names", () => {
    const interaction = interactionOf(
      "",
      '<qti-interaction-modules primary-configuration="modules/maths_config.js" secondary-configuration="modules/maths_fallback.js"><qti-interaction-module id="m"/></qti-interaction-modules><qti-interaction-markup/>',
    );
    expect(moduleConfigurationPaths(interaction)).toEqual({
      primary: "modules/maths_config.js",
      fallback: "modules/maths_fallback.js",
    });
  });

  it("refuses an interaction that is not one", () => {
    expect(() => moduleConfigurationPaths(json("null"))).toThrow(DataError);
  });
});

describe("resolvePciModules", () => {
  it("[J6] locates the module of the module attribute and its dependencies in the primary configuration (BPIG §3.7.12.4)", () => {
    const modules = resolvePciModules(interactionOf('module="exampleLikertScale"'), {
      primary: resolution({ exampleLikertScale: "modules/likert", handlebars: "modules/lib/handlebars.min" }),
    });
    expect(modules).toEqual([
      { id: "exampleLikertScale", primary: "modules/likert", packageRelative: true },
      { id: "handlebars", primary: "modules/lib/handlebars.min", packageRelative: true },
    ]);
  });

  it("[J6] lets a qti-interaction-module replace the location of a module, as the graphing example of BPIG §3.7.12.4 does", () => {
    const interaction = interactionOf(
      'module="exampleGraphing"',
      '<qti-interaction-modules primary-configuration="modules/maths_config.js"><qti-interaction-module id="handlebars" primary-path="modules/lib/handlebarsV2.min"/></qti-interaction-modules><qti-interaction-markup/>',
    );
    const primary = resolution(
      {
        exampleLikertScale: "modules/likert",
        exampleGraphing: "modules/graphing",
        handlebars: "modules/lib/handlebarsv101.min",
      },
      10,
    );
    expect(resolvePciModules(interaction, { primary })).toEqual([
      { id: "exampleGraphing", primary: "modules/graphing", packageRelative: true },
      { id: "handlebars", primary: "modules/lib/handlebarsV2.min", packageRelative: true },
      { id: "exampleLikertScale", primary: "modules/likert", packageRelative: true },
    ]);
  });

  it("[J6] gives the primary and the fallback location of a module and says whether the first one is in the package", () => {
    const modules = resolvePciModules(interactionOf('module="graph"'), {
      primary: resolution({ graph: "https://cdn.example.com/graph", local: "modules/local" }),
      fallback: resolution({ graph: "modules/graph", local: "modules/local-fallback", only: "modules/only" }),
    });
    expect(modules).toEqual([
      { id: "graph", primary: "https://cdn.example.com/graph", fallback: "modules/graph", packageRelative: false },
      { id: "local", primary: "modules/local", fallback: "modules/local-fallback", packageRelative: true },
      { id: "only", fallback: "modules/only", packageRelative: true },
    ]);
  });

  it("[J6] lists a module that only the interaction names, without a location", () => {
    const interaction = interactionOf(
      "",
      '<qti-interaction-modules><qti-interaction-module id="lonely"/></qti-interaction-modules><qti-interaction-markup/>',
    );
    expect(resolvePciModules(interaction, {})).toEqual([{ id: "lonely", packageRelative: false }]);
  });

  it("[J6] puts each module once and keeps the id __proto__ as data", () => {
    const modules = resolvePciModules(interactionOf('module="__proto__"'), {
      primary: { waitSeconds: 7, paths: new Map([["__proto__", "modules/p"]]) },
      fallback: { waitSeconds: 7, paths: new Map([["__proto__", "modules/q"]]) },
    });
    expect(modules).toEqual([{ id: "__proto__", primary: "modules/p", fallback: "modules/q", packageRelative: true }]);
  });

  it("refuses arguments of the wrong type", () => {
    const interaction = interactionOf('module="m"');
    expect(() => resolvePciModules(json("null"), {})).toThrow(DataError);
    expect(() => resolvePciModules(interaction, json("null"))).toThrow(DataError);
    expect(() => resolvePciModules(interaction, json('{"primary": 1}'))).toThrow(DataError);
    expect(() => resolvePciModules(interaction, json('{"primary": {"paths": {}}}'))).toThrow(
      "The paths of the primary configuration must be a Map, found an object.",
    );
  });
});

describe("pciProperties", () => {
  it("[J8] passes the data- attributes named as element.dataset names them: data-max-choices-message is maxChoicesMessage", () => {
    const interaction = interactionOf(
      'data-label-min="Very Poorly" data-max-choices-message="Too Many" data-toggle="true" data-selected_color="blue" data-n1="x" data-x-1="y" data-a--b="z" class="horizontal"',
    );
    expect([...pciProperties(interaction)]).toEqual([
      ["labelMin", "Very Poorly"],
      ["maxChoicesMessage", "Too Many"],
      ["toggle", "true"],
      ["selected_color", "blue"],
      ["n1", "x"],
      ["x-1", "y"],
      ["a-B", "z"],
    ]);
  });

  it("[J8] leaves out the attributes that QTI defines and those that are not data attributes", () => {
    const interaction = interactionOf(
      'data-catalog-idref="c1" data-qti-suppress-tts="all" xml:lang="en" data-custom="1"',
    );
    expect([...pciProperties(interaction)]).toEqual([["custom", "1"]]);
    expect(pciProperties(interactionOf('module="m"')).size).toBe(0);
  });

  it("refuses an interaction that is not one", () => {
    expect(() => pciProperties(json("null"))).toThrow(DataError);
  });
});

describe("the variables a PCI is bound to", () => {
  it("[J8] passes the template and context variables that the PCI names, and the markup, as the value of the variable in the JSON of Appendix C", () => {
    const document = readAsi(
      `<qti-assessment-item ${NS} identifier="item" title="Item" time-dependent="false"><qti-context-declaration identifier="CTX" cardinality="single" base-type="string"/><qti-template-declaration identifier="N" cardinality="multiple" base-type="integer"/><qti-item-body><qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:fdc:example.com:pci:v" module="m"><qti-interaction-markup><p>Graph <qti-printed-variable identifier="N"/></p></qti-interaction-markup><qti-template-variable template-identifier="N"/><qti-context-variable identifier="CTX"/></qti-portable-custom-interaction></qti-item-body></qti-assessment-item>`,
    );
    if (document.kind !== "item") throw new Error("The test reads an item.");
    const [interaction] = document.item.body?.children ?? [];
    if (interaction?.kind !== "portable-custom-interaction") throw new Error("The test reads a PCI.");
    expect(interaction.templateVariables.map(({ templateIdentifier }) => templateIdentifier)).toEqual(["N"]);
    expect(interaction.contextVariables.map(({ identifier }) => identifier)).toEqual(["CTX"]);
    expect(interaction.interactionMarkup.children[0]?.kind).toBe("p");
    const declaration = document.item.templateDeclarations[0];
    expect(declaration).toBeDefined();
    expect(
      encodePciValue(container("multiple", "integer", [3, 4]), { cardinality: "multiple", baseType: "integer" }, HOST),
    ).toEqual({
      list: { integer: [3, 4] },
    });
  });
});

describe("checkPortableInteraction", () => {
  const codes = (interaction: PortableCustomInteraction, configuration: PciModuleConfiguration): string[] =>
    checkPortableInteraction(interaction, configuration).map(({ code }) => code);
  const configured: PciModuleConfiguration = { primary: resolution({ m: "modules/m" }) };

  it("[J6][N] reports an interaction with neither a module attribute nor qti-interaction-modules", () => {
    const [issue] = checkPortableInteraction(interactionOf(""), configured);
    expect(issue).toEqual({
      severity: "error",
      code: "assesskit/pci/no-module",
      message:
        'The interaction with the response identifier "R" has neither a module attribute nor a qti-interaction-modules element, so no module can be loaded for it.',
      source: "BPIG §3.7.12.4",
      location: { element: "qti-portable-custom-interaction" },
    });
  });

  it("[J6][N] reports a module that no configuration locates, and accepts one that the interaction locates itself", () => {
    expect(codes(interactionOf('module="unknown"'), configured)).toEqual(["assesskit/pci/module-not-configured"]);
    expect(codes(interactionOf('module="m"'), configured)).toEqual([]);
    expect(codes(interactionOf('module="m"'), { fallback: resolution({ m: "modules/m" }) })).toEqual([]);
    const own = interactionOf(
      "",
      '<qti-interaction-modules><qti-interaction-module id="x" primary-path="modules/x"/><qti-interaction-module id="y"/></qti-interaction-modules><qti-interaction-markup/>',
    );
    expect(codes(own, {})).toEqual(["assesskit/pci/module-not-configured"]);
    expect(checkPortableInteraction(own, {})[0]?.message).toContain('"y"');
  });

  it("[J7][N] warns about a custom-interaction-type-identifier that is not a Federated Content URN, and not about one that is", () => {
    const interaction = (type: string): PortableCustomInteraction => {
      const document = readAsi(
        `<qti-assessment-item ${NS} identifier="item" title="Item" time-dependent="false"><qti-item-body><qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="${type}" module="m"><qti-interaction-markup/></qti-portable-custom-interaction></qti-item-body></qti-assessment-item>`,
      );
      const [node] = document.kind === "item" ? (document.item.body?.children ?? []) : [];
      if (node?.kind !== "portable-custom-interaction") throw new Error("The test reads a PCI.");
      return node;
    };
    expect(checkPortableInteraction(interaction("urn:fdc:hmhco.com:pci:tapToReveal"), configured)).toEqual([]);
    expect(checkPortableInteraction(interaction("URN:FDC:example.com:2024:x"), configured)).toEqual([]);
    const [warning] = checkPortableInteraction(interaction("urn-fdc-hmhco.com-pci-tapToReveal"), configured);
    expect(warning).toMatchObject({
      severity: "warning",
      code: "assesskit/pci/type-identifier",
      source: "BPIG §3.7.12",
    });
    expect(warning?.message).toContain('"urn-fdc-hmhco.com-pci-tapToReveal"');
    expect(codes(interaction("my-pci"), configured)).toEqual(["assesskit/pci/type-identifier"]);
  });

  it("refuses arguments of the wrong type", () => {
    expect(() => checkPortableInteraction(json("null"), {})).toThrow(DataError);
    expect(() => checkPortableInteraction(interactionOf('module="m"'), json("1"))).toThrow(DataError);
  });
});
