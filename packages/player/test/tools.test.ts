import type { SupportView } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { CalculatorType, SupportName, SupportState } from "@assesskit/runtime/pnp";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BASIC_KEYS,
  type CalculatorKey,
  type CalculatorState,
  DIGIT_KEYS,
  INITIAL_STATE,
  KEYBOARD_KEYS,
  press,
  STANDARD_ONLY_KEYS,
} from "../src/player/tools/calculator-engine.js";
import { checkToolsInput } from "../src/player/tools/check-input.js";
import {
  ANGLE_UNITS,
  LENGTH_UNITS,
  type ProtractorSpec,
  type RuleSpec,
  type ToolsInput,
} from "../src/player/tools/model.js";
import { formatNumber } from "../src/player/tools/numbers.js";
import { resolveTools } from "../src/player/tools/resolve.js";
import {
  CSS_PX_PER_MM,
  degrees,
  MIN_LABEL_PX,
  MIN_TICK_PX,
  millimeters,
  protractorScale,
  ruleScale,
  unitSymbol,
} from "../src/player/tools/scale.js";
import { fuzzJson } from "./fuzz.js";
import { supportView } from "./supports-fixture.js";
import {
  calculatorXml,
  companion,
  digitalXml,
  PROTRACTOR_DESCRIPTION,
  PROTRACTOR_XML,
  protractorXml,
  RULE_DESCRIPTION,
  RULE_XML,
  ruleXml,
} from "./tools-fixture.js";

/** Passes input as JSON delivers it, which TypeScript does not check. */
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** The keys that a character of a test stands for; a digit stands for its own key. */
const CHARACTER_KEYS: ReadonlyMap<string, CalculatorKey> = new Map<string, CalculatorKey>([
  ...DIGIT_KEYS.map((digit): [string, CalculatorKey] => [digit, digit]),
  ["+", "add"],
  ["-", "subtract"],
  ["*", "multiply"],
  ["/", "divide"],
  ["=", "equals"],
  [".", "decimal"],
  ["C", "clear"],
  ["r", "square-root"],
  ["%", "percent"],
  ["~", "sign"],
  ["m", "memory-add"],
  ["n", "memory-subtract"],
  ["R", "memory-recall"],
  ["X", "memory-clear"],
]);

/** Presses the keys that the characters of a text stand for, one after the other. */
function type(characters: string, from: CalculatorState = INITIAL_STATE): CalculatorState {
  return [...characters].reduce((state, character) => {
    const key = CHARACTER_KEYS.get(character);
    if (key === undefined) throw new Error(`The test has no key for ${character}.`);
    return press(state, key);
  }, from);
}

const shows = (keys: string): string => {
  const state = type(keys);
  return state.error ? "error" : state.display;
};

describe("numbers", () => {
  it("[T93] leaves the noise of binary fractions off the display", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(1 / 3)).toBe("0.333333333333");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(1_000_000)).toBe("1000000");
  });
});

describe("calculator-engine", () => {
  it("[T93] types numbers: digits, one decimal point, a leading zero kept once", () => {
    expect(shows("123")).toBe("123");
    expect(shows("007")).toBe("7");
    expect(shows(".5")).toBe("0.5");
    expect(shows("1..5")).toBe("1.5");
    expect(shows("1.50")).toBe("1.50");
  });

  it("[T93] stops typing at 12 digits, the width of the display", () => {
    expect(shows("1234567890123")).toBe("123456789012");
    expect(shows("0.123456789012345")).toBe("0.12345678901");
  });

  it("[T93] adds, subtracts, multiplies and divides: the four operations of the basic calculator (BPIG §3.7.8.1)", () => {
    expect(shows("2+3=")).toBe("5");
    expect(shows("9-12=")).toBe("-3");
    expect(shows("6*7=")).toBe("42");
    expect(shows("1/4=")).toBe("0.25");
  });

  it("[T93] rounds to 12 significant digits, so that 0.1 + 0.2 is 0.3", () => {
    expect(shows("0.1+0.2=")).toBe("0.3");
    expect(shows("1/3=")).toBe("0.333333333333");
  });

  it("[T93] runs operations as they are entered, from left to right, like a desktop calculator", () => {
    expect(shows("2+3*4=")).toBe("20");
    expect(shows("2+3*")).toBe("5");
  });

  it("[T93] replaces the operation when two are pressed in a row", () => {
    expect(shows("5+*3=")).toBe("15");
  });

  it("[T93] continues from a result, and starts a new number with a digit", () => {
    expect(shows("2+3=*4=")).toBe("20");
    expect(shows("2+3=7")).toBe("7");
    expect(shows("2+3=7+1=")).toBe("8");
  });

  it("[T93] shows an error for a division by zero, and only clear takes it away", () => {
    expect(shows("7/0=")).toBe("error");
    expect(shows("7/0=5")).toBe("error");
    expect(shows("7/0=C5")).toBe("5");
    expect(shows("0/0=")).toBe("error");
  });

  it("[T93] clears the calculation and keeps the memory", () => {
    const cleared = type("5m3+C");
    expect(cleared.display).toBe("0");
    expect(cleared.operator).toBeNull();
    expect(cleared.memory).toBe(5);
  });

  it("[T93] changes the sign of the number being typed, of a result, and of a number to come", () => {
    expect(shows("5~")).toBe("-5");
    expect(shows("5~~")).toBe("5");
    expect(shows("5~7")).toBe("-57");
    expect(shows("2-3=~")).toBe("1");
    expect(shows("0~5")).toBe("-5");
    expect(shows("5+~=")).toBe("0");
  });

  it("[T93] takes the square root, and fails for a negative number", () => {
    expect(shows("9r")).toBe("3");
    expect(shows("2r")).toBe("1.41421356237");
    expect(shows("4~r")).toBe("error");
    expect(shows("9+16r=")).toBe("13");
  });

  it("[T93] takes percents: of the left operand after + and -, and a hundredth otherwise", () => {
    expect(shows("200+10%=")).toBe("220");
    expect(shows("200-10%=")).toBe("180");
    expect(shows("200*10%=")).toBe("20");
    expect(shows("200/50%=")).toBe("400");
    expect(shows("50%")).toBe("0.5");
  });

  it("[T93] keeps a memory: add, subtract, recall and clear", () => {
    expect(type("5m").memory).toBe(5);
    expect(type("5m3n").memory).toBe(2);
    expect(shows("5m3R")).toBe("5");
    expect(shows("5m3RX9R")).toBe("0");
    expect(type("5mX").memory).toBe(0);
    expect(shows("5m3+R=")).toBe("8");
  });

  it("[T93] starts a new number after the memory takes the one on the display", () => {
    expect(shows("5m7")).toBe("7");
    expect(shows("5m7+1=")).toBe("8");
  });

  it("[T93] keeps the memory through an error", () => {
    expect(type("5m1/0=").memory).toBe(5);
  });

  it("[T93] has the keys of the basic calculator in the standard one, which adds the others (BPIG §3.7.8.1)", () => {
    expect([...BASIC_KEYS].sort()).toEqual(
      [..."0123456789", "decimal", "add", "subtract", "multiply", "divide", "equals", "clear"].sort(),
    );
    expect([...STANDARD_ONLY_KEYS].sort()).toEqual(
      ["square-root", "percent", "sign", "memory-clear", "memory-recall", "memory-add", "memory-subtract"].sort(),
    );
  });

  it("[SC 2.1.4] maps characters to keys, so that typing needs the focus in the calculator", () => {
    expect(KEYBOARD_KEYS.get("7")).toBe("7");
    expect(KEYBOARD_KEYS.get("+")).toBe("add");
    expect(KEYBOARD_KEYS.get("Enter")).toBe("equals");
    expect(KEYBOARD_KEYS.get("Escape")).toBe("clear");
    expect(KEYBOARD_KEYS.get("a")).toBeUndefined();
  });
});

describe("calculator-engine properties", () => {
  const anyKey = fc.constantFrom<CalculatorKey>(...BASIC_KEYS, ...STANDARD_ONLY_KEYS);

  it("[T93] never throws, and its display is a finite number or an error", () => {
    fc.assert(
      fc.property(fc.array(anyKey, { maxLength: 40 }), (keys) => {
        const state = keys.reduce(press, INITIAL_STATE);
        expect(Number.isFinite(Number(state.display))).toBe(true);
        expect(Number.isFinite(state.memory)).toBe(true);
        if (state.error) expect(state.display).toBe("0");
      }),
    );
  });

  it("[T93] shows the digits typed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999_999_999_999 }), (value) => {
        expect(shows(String(value))).toBe(String(value));
      }),
    );
  });

  it("[T93] gives the result of the operation that JavaScript gives, for whole numbers", () => {
    const operations: readonly (readonly [string, (a: number, b: number) => number])[] = [
      ["+", (a, b) => a + b],
      ["-", (a, b) => a - b],
      ["*", (a, b) => a * b],
    ];
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99_999 }),
        fc.integer({ min: 0, max: 99_999 }),
        fc.constantFrom(...operations),
        (a, b, [symbol, operate]) => {
          expect(shows(`${a}${symbol}${b}=`)).toBe(String(operate(a, b)));
        },
      ),
    );
  });

  it("[T93] returns to the initial state, memory aside, on clear", () => {
    fc.assert(
      fc.property(fc.array(anyKey, { maxLength: 40 }), (keys) => {
        const state = press(keys.reduce(press, INITIAL_STATE), "clear");
        expect(state).toEqual({ ...INITIAL_STATE, memory: state.memory });
      }),
    );
  });
});

const RULE_SPEC: RuleSpec = {
  minimumLength: 10,
  minorIncrement: { value: 0.5, unit: "Meter" },
  majorIncrement: { value: 1, unit: "Meter" },
};

const PROTRACTOR_SPEC: ProtractorSpec = {
  minorIncrement: { value: 1, unit: "Degree" },
  majorIncrement: { value: 5, unit: "Degree" },
};

/** What a test says of a tool support: the settings the tools read are given as fields. */
interface ToolSupportFields {
  readonly name: SupportName;
  readonly state?: SupportState;
  readonly active?: boolean;
  readonly highlightColor?: string;
  readonly calculatorType?: CalculatorType;
}

const support = ({ name, state, active, highlightColor, calculatorType }: ToolSupportFields): SupportView => {
  const fields = { ...(state === undefined ? {} : { state }), ...(active === undefined ? {} : { active }) };
  if (name === "line-reader" && highlightColor !== undefined) {
    return supportView(name, { ...fields, settings: { name, replaceAccessModes: [], highlightColor } });
  }
  if (name === "calculator-on-screen" && calculatorType !== undefined) {
    return supportView(name, { ...fields, settings: { name, calculatorType } });
  }
  return supportView(name, fields);
};

describe("check-input", () => {
  const valid: ToolsInput = {
    companion: companion({
      calculators: [
        calculatorXml("basic", "4 function calculator", { href: "tools/calculator.html", mimeType: "text/html" }),
      ],
      rules: [RULE_XML],
      protractors: [PROTRACTOR_XML],
      digital: [
        digitalXml("directory001/table.pdf", {
          label: "The Periodic Table",
          mimeType: "application/pdf",
          icon: "i.svg",
        }),
      ],
      physical: ["Supply scissors and 2 sheets of 8.5 x 11 inch white paper."],
    }),
    supports: [
      support({ name: "line-reader", highlightColor: "#336699" }),
      support({ name: "calculator-on-screen", calculatorType: "ext:iowa" }),
    ],
  };

  it("[T63] accepts the companion materials of BPIG §3.7.8 as the runtime reads them, and the supports of the profile", () => {
    expect(() => checkToolsInput(valid)).not.toThrow();
    expect(() => checkToolsInput(json(valid))).not.toThrow();
    expect(() => checkToolsInput({ companion: null, supports: [] })).not.toThrow();
    expect(() => checkToolsInput({ companion: companion(), supports: [] })).not.toThrow();
  });

  it("rejects input of other types with a sentence that names the property", () => {
    const rejects = (value: unknown, message: string): void => {
      expect(() => checkToolsInput(value)).toThrow(new DataError(message));
    };
    rejects(JSON.parse("null"), "The tools input is invalid: expected an object, found null.");
    rejects(JSON.parse("[]"), "The tools input is invalid: expected an object, found an array.");
    rejects({ supports: [] }, 'The tools input is invalid: missing the property "companion".');
    rejects({ companion: null }, 'The tools input is invalid: missing the property "supports".');
    rejects({ companion: null, supports: {} }, "The property supports is invalid: expected an array, found an object.");
    rejects({ companion: null, supports: [], extra: 1 }, 'The tools input is invalid: unexpected property "extra".');
    rejects({ companion: 1, supports: [] }, "The tools input is invalid at companion: expected an object, found 1.");
  });

  it("rejects a material that is not what INFO §5.24 to §5.80 define", () => {
    /** Checks a JSON copy of the companion materials of an item in which the value at `path` is replaced; `undefined` removes it. */
    const rejects = (
      items: Parameters<typeof companion>[0],
      path: readonly (string | number)[],
      replacement: unknown,
      message: string,
    ): void => {
      const materials: unknown = JSON.parse(JSON.stringify(companion(items)));
      let node = materials;
      for (const key of path.slice(0, -1))
        node = typeof node === "object" && node !== null ? Reflect.get(node, key) : node;
      const last = path.at(-1) ?? "";
      if (typeof node !== "object" || node === null) throw new Error("The path leaves the materials.");
      if (replacement === undefined) Reflect.deleteProperty(node, last);
      else Reflect.set(node, last, replacement);
      expect(() => checkToolsInput({ companion: materials, supports: [] })).toThrow(new DataError(message));
    };
    const calculators = { calculators: [calculatorXml("basic", "B")] };
    const rules = { rules: [RULE_XML] };
    const protractors = { protractors: [PROTRACTOR_XML] };
    const digital = { digital: [digitalXml("a.pdf")] };
    const calculator = ["calculators", 0] as const;
    const system = ["rules", 0, "ruleSystem"] as const;
    const increment = ["protractors", 0, "increment"] as const;
    const file = ["digitalMaterials", 0] as const;
    rejects(
      calculators,
      [...calculator, "calculatorType", "value"],
      "graphic",
      'The tools input is invalid at companion.calculators[0].calculatorType.value: expected "basic", "standard", "scientific" or "graphing", found "graphic".',
    );
    rejects(
      calculators,
      [...calculator, "description"],
      undefined,
      'The tools input is invalid at companion.calculators[0]: missing the property "description".',
    );
    rejects(
      calculators,
      [...calculator, "description", "value"],
      5,
      "The tools input is invalid at companion.calculators[0].description.value: expected a string, found 5.",
    );
    rejects(
      { calculators: [calculatorXml("basic", "B", { href: "c.html" })] },
      [...calculator, "calculatorInfo", "fileHref", "value"],
      "",
      "The tools input is invalid at companion.calculators[0].calculatorInfo.fileHref.value: expected a length of at least 1, found 0.",
    );
    rejects(
      rules,
      [...system, "minimumLength", "value"],
      0,
      "The tools input is invalid at companion.rules[0].ruleSystem.minimumLength.value: expected a positive number, found 0.",
    );
    rejects(
      rules,
      [...system, "minimumLength", "value"],
      "10",
      'The tools input is invalid at companion.rules[0].ruleSystem.minimumLength.value: expected a number, found "10".',
    );
    rejects(
      rules,
      [...system, "majorIncrement", "unit"],
      "Radian",
      'The tools input is invalid at companion.rules[0].ruleSystem.majorIncrement.unit: expected "Millimeter", "Centimeter", "Meter", "Kilometer", "Inch", "Foot", "Yard" or "Mile", found "Radian".',
    );
    rejects(
      rules,
      [...system, "majorIncrement"],
      null,
      "The tools input is invalid at companion.rules[0].ruleSystem.majorIncrement: expected an object, found null.",
    );
    rejects(
      rules,
      [...system, "minorIncrement", "value"],
      "-1",
      'The tools input is invalid at companion.rules[0].ruleSystem.minorIncrement.value: expected a decimal greater than 0, found "-1".',
    );
    rejects(
      rules,
      [...system, "majorIncrement", "value"],
      "many",
      'The tools input is invalid at companion.rules[0].ruleSystem.majorIncrement.value: expected a decimal greater than 0, found "many".',
    );
    rejects(
      rules,
      [...system, "majorIncrement", "value"],
      1,
      "The tools input is invalid at companion.rules[0].ruleSystem.majorIncrement.value: expected a string, found 1.",
    );
    rejects(
      rules,
      system,
      undefined,
      'The tools input is invalid at companion.rules[0]: missing the property "ruleSystem".',
    );
    rejects(
      protractors,
      [...increment, "majorIncrement", "unit"],
      "Meter",
      'The tools input is invalid at companion.protractors[0].increment.majorIncrement.unit: expected "Radian", "Degree", "Minute" or "Second", found "Meter".',
    );
    rejects(
      protractors,
      increment,
      [],
      "The tools input is invalid at companion.protractors[0].increment: expected an object, found an array.",
    );
    rejects(
      digital,
      [...file, "fileHref", "value"],
      "",
      "The tools input is invalid at companion.digitalMaterials[0].fileHref.value: expected a length of at least 1, found 0.",
    );
    rejects(
      digital,
      [...file, "label"],
      1,
      "The tools input is invalid at companion.digitalMaterials[0].label: expected a string, found 1.",
    );
    rejects(
      { digital: [digitalXml("a.png", { icon: "i.png" })] },
      [...file, "resourceIcon", "value"],
      1,
      "The tools input is invalid at companion.digitalMaterials[0].resourceIcon.value: expected a string, found 1.",
    );
    rejects(
      { physical: ["Paper."] },
      ["physicalMaterials", 0, "value"],
      1,
      "The tools input is invalid at companion.physicalMaterials[0].value: expected a string, found 1.",
    );
    rejects(
      {},
      ["digitalMaterials"],
      {},
      "The tools input is invalid at companion.digitalMaterials: expected an array, found an object.",
    );
  });

  it("[T75] accepts any support of the view and ignores the ones that put no tool on the screen", () => {
    const supports = [supportView("spoken", { state: "active", active: true }), support({ name: "line-reader" })];
    expect(() => checkToolsInput({ companion: null, supports })).not.toThrow();
    expect(resolveTools({ companion: null, supports }).tools.map(({ spec }) => spec.kind)).toEqual(["line-reader"]);
  });

  it("rejects a support that is not a support view of the runtime", () => {
    const rejects = (supports: unknown, message: string): void => {
      expect(() => checkToolsInput(json({ companion: null, supports }))).toThrow(new DataError(message));
    };
    rejects(
      [{ name: "bogus", state: "assigned", active: true }],
      'The property supports is invalid at [0].name: expected the name of a support, found "bogus".',
    );
    rejects(
      [{ name: "line-reader", state: "on", active: true }],
      'The property supports is invalid at [0].state: expected "prohibited", "active", "option" or "assigned", found "on".',
    );
    rejects(
      [{ name: "line-reader", state: "active", active: "yes" }],
      'The property supports is invalid at [0].active: expected true or false, found "yes".',
    );
    rejects(
      [
        {
          name: "line-reader",
          state: "active",
          active: true,
          settings: { name: "line-reader", highlightColor: "red" },
        },
      ],
      'The property supports is invalid at [0]: the settings are invalid at highlightColor: expected a color as #RGB or #RRGGBB, found "red".',
    );
    rejects(
      [{ name: "line-reader", state: "active", active: true, settings: { name: "line-reader", highlightColor: 5 } }],
      "The property supports is invalid at [0]: the settings are invalid at highlightColor: expected a string, found 5.",
    );
    rejects([null], "The property supports is invalid at [0]: expected an object, found null.");
  });

  it("accepts colors as #RGB and #RRGGBB in either case", () => {
    for (const highlightColor of ["#369", "#336699", "#AbCdEf"]) {
      expect(() =>
        checkToolsInput(json({ companion: null, supports: [support({ name: "line-reader", highlightColor })] })),
      ).not.toThrow();
    }
  });

  it("reads or refuses arbitrary JSON with a DataError, and nothing else", () => {
    fuzzJson((value) => checkToolsInput(value), [json(valid), { companion: null, supports: [] }]);
  });
});

describe("resolve", () => {
  it("[T63] puts the companion materials in force: rules, protractors, calculators, digital materials, then physical ones apart", () => {
    const set = resolveTools({
      companion: companion({
        calculators: [calculatorXml("standard", "Standard")],
        rules: [RULE_XML],
        protractors: [PROTRACTOR_XML],
        digital: [digitalXml("a/b.pdf", { label: "Periodic table" })],
        physical: ["Supply scissors."],
      }),
      supports: [],
    });
    expect(set.tools.map(({ spec }) => spec.kind)).toEqual(["rule", "protractor", "calculator", "digital"]);
    expect(set.tools.map(({ description }) => description)).toEqual([
      RULE_DESCRIPTION,
      PROTRACTOR_DESCRIPTION,
      "Standard",
      null,
    ]);
    expect(set.tools.every(({ support }) => support === null)).toBe(true);
    expect(set.physical).toEqual(["Supply scissors."]);
  });

  it("[T63] reads the rule of BPIG §3.7.8.2 and the protractor of BPIG §3.7.8.3 as numbers in their units", () => {
    const [rule, protractor] = resolveTools({
      companion: companion({ rules: [RULE_XML], protractors: [PROTRACTOR_XML] }),
      supports: [],
    }).tools;
    expect(rule?.spec).toEqual({ kind: "rule", rule: RULE_SPEC });
    expect(protractor?.spec).toEqual({ kind: "protractor", protractor: PROTRACTOR_SPEC });
  });

  it("[T63] reads a rule in US units and a protractor in radians, and leaves out a minor increment that the item does not give", () => {
    const [rule, protractor] = resolveTools({
      companion: companion({
        rules: [ruleXml("Yardstick", 2, ["1", "Inch"], undefined, "us")],
        protractors: [protractorXml("Radians", ["0.5", "Radian"], undefined, "si")],
      }),
      supports: [],
    }).tools;
    expect(rule?.spec).toEqual({
      kind: "rule",
      rule: { minimumLength: 2, majorIncrement: { value: 1, unit: "Inch" } },
    });
    expect(protractor?.spec).toEqual({
      kind: "protractor",
      protractor: { majorIncrement: { value: 0.5, unit: "Radian" } },
    });
  });

  it("[T63] keeps the digital material as the runtime reads it", () => {
    const [tool] = resolveTools({
      companion: companion({
        digital: [
          digitalXml("files/table.pdf", {
            label: "The Periodic Table",
            mimeType: "application/pdf",
            icon: "files/table.svg",
          }),
        ],
      }),
      supports: [],
    }).tools;
    expect(tool?.spec).toMatchObject({
      kind: "digital",
      material: {
        label: "The Periodic Table",
        mimeType: "application/pdf",
        fileHref: { value: "files/table.pdf" },
        resourceIcon: { value: "files/table.svg" },
      },
    });
  });

  it("[T63] gives the same tool the same key, and two tools different keys", () => {
    const keyOf = (rule: string) =>
      resolveTools({ companion: companion({ rules: [rule] }), supports: [] }).tools[0]?.key;
    expect(keyOf(ruleXml("Another description", 10, ["1.0", "Meter"], ["0.5", "Meter"]))).toBe(keyOf(RULE_XML));
    expect(keyOf(ruleXml("Longer", 20, ["1", "Meter"], ["0.5", "Meter"]))).not.toBe(keyOf(RULE_XML));
  });

  it("[T63] keeps one of two equal rules", () => {
    expect(resolveTools({ companion: companion({ rules: [RULE_XML, RULE_XML] }), supports: [] }).tools).toHaveLength(1);
  });

  it("[T63] builds in the basic and standard calculators and leaves the others to the host (the player design D1)", () => {
    const kinds = (types: readonly string[]) =>
      resolveTools({
        companion: companion({ calculators: types.map((type) => calculatorXml(type, type)) }),
        supports: [],
      }).tools.map(({ spec }) =>
        spec.kind === "slot" ? spec.tool : spec.kind === "calculator" ? spec.type : spec.kind,
      );
    expect(kinds(["basic", "standard", "scientific", "graphing"])).toEqual([
      "basic",
      "standard",
      "scientific-calculator",
      "graphing-calculator",
    ]);
  });

  it("[T86] puts the line reader on the screen with the color of the profile, or none", () => {
    const [colored, plain] = [
      resolveTools({
        companion: null,
        supports: [support({ name: "line-reader", highlightColor: "#336699", state: "option" })],
      }),
      resolveTools({ companion: null, supports: [support({ name: "line-reader", state: "active", active: true })] }),
    ];
    expect(colored.tools[0]?.spec).toEqual({ kind: "line-reader", highlightColor: "#336699" });
    expect(colored.tools[0]?.support).toMatchObject({ name: "line-reader", active: false });
    expect(plain.tools[0]?.spec).toEqual({ kind: "line-reader", highlightColor: null });
    expect(plain.tools[0]?.support).toMatchObject({ name: "line-reader", active: true });
  });

  it("[T92] puts answer masking on the screen", () => {
    const set = resolveTools({ companion: null, supports: [support({ name: "answer-masking", active: true })] });
    expect(set.tools).toEqual([
      {
        key: '{"kind":"answer-masking"}',
        spec: { kind: "answer-masking" },
        description: null,
        file: null,
        support: { name: "answer-masking", state: "assigned", active: true },
      },
    ]);
  });

  it("[T93] puts the calculator of the profile on the screen when the item has none, whatever the test says ([CERT] A-12)", () => {
    const set = resolveTools({
      companion: companion(),
      supports: [
        support({ name: "calculator-on-screen", calculatorType: "scientific", state: "active", active: true }),
      ],
    });
    expect(set.tools).toHaveLength(1);
    expect(set.tools[0]?.spec).toEqual({ kind: "slot", tool: "scientific-calculator" });
    expect(set.tools[0]?.support).toMatchObject({ name: "calculator-on-screen", active: true });
  });

  it("[T93] gives a profile that names no calculator type a basic calculator, and one that names an extension term none", () => {
    const basic = resolveTools({ companion: null, supports: [support({ name: "calculator-on-screen" })] });
    expect(basic.tools[0]?.spec).toEqual({ kind: "calculator", type: "basic" });
    const extension = resolveTools({
      companion: null,
      supports: [support({ name: "calculator-on-screen", calculatorType: "ext:iowa" })],
    });
    expect(extension.tools).toEqual([]);
  });

  it("[T93] makes one tool of the calculator that the item and the profile both name, and keeps the item's description", () => {
    const set = resolveTools({
      companion: companion({ calculators: [calculatorXml("standard", "Standard calculator")] }),
      supports: [support({ name: "calculator-on-screen", calculatorType: "standard", active: true })],
    });
    expect(set.tools).toHaveLength(1);
    expect(set.tools[0]?.description).toBe("Standard calculator");
    expect(set.tools[0]?.support).toMatchObject({ name: "calculator-on-screen", active: true });
  });

  it("[T93] keeps the calculator of the item and adds the one of the profile when their types differ", () => {
    const set = resolveTools({
      companion: companion({ calculators: [calculatorXml("basic", "Basic")] }),
      supports: [support({ name: "calculator-on-screen", calculatorType: "standard" })],
    });
    expect(set.tools.map(({ spec }) => spec)).toEqual([
      { kind: "calculator", type: "basic" },
      { kind: "calculator", type: "standard" },
    ]);
    expect(set.tools.map(({ support }) => support?.name ?? null)).toEqual([null, "calculator-on-screen"]);
  });

  it("[T93] removes every calculator, the item's included, when the profile prohibits calculator-on-screen", () => {
    const set = resolveTools({
      companion: companion({ calculators: [calculatorXml("basic", "Basic")], rules: [RULE_XML] }),
      supports: [support({ name: "calculator-on-screen", state: "prohibited" })],
    });
    expect(set.tools.map(({ spec }) => spec.kind)).toEqual(["rule"]);
  });

  it("[T93] keeps the file of a calculator with the calculator, as the runtime reads it (INFO §5.24.3)", () => {
    const set = resolveTools({
      companion: companion({
        calculators: [
          calculatorXml("scientific", "Scientific", {
            href: "tools/sci.html",
            label: "Scientific file",
            mimeType: "text/html",
          }),
          calculatorXml("basic", "Basic"),
        ],
      }),
      supports: [],
    });
    expect(set.tools.map(({ spec }) => spec.kind)).toEqual(["slot", "calculator"]);
    expect(set.tools[0]?.file).toMatchObject({
      kind: "calculator-info",
      label: "Scientific file",
      mimeType: "text/html",
      fileHref: { value: "tools/sci.html" },
    });
    expect(set.tools[1]?.file).toBeNull();
  });

  it("[T93] keeps the file of the item's calculator when the profile names the same calculator", () => {
    const set = resolveTools({
      companion: companion({ calculators: [calculatorXml("standard", "Standard", { href: "tools/standard.pdf" })] }),
      supports: [support({ name: "calculator-on-screen", calculatorType: "standard", active: true })],
    });
    expect(set.tools).toHaveLength(1);
    expect(set.tools[0]?.file).toMatchObject({ fileHref: { value: "tools/standard.pdf" } });
    expect(set.tools[0]?.support).toMatchObject({ name: "calculator-on-screen", active: true });
  });

  it("[T93] has no file for the calculator of a profile", () => {
    const set = resolveTools({ companion: null, supports: [support({ name: "calculator-on-screen" })] });
    expect(set.tools[0]?.file).toBeNull();
  });

  it("[T93] removes the calculator with its file when the profile prohibits calculator-on-screen", () => {
    const set = resolveTools({
      companion: companion({ calculators: [calculatorXml("basic", "Basic", { href: "tools/basic.html" })] }),
      supports: [support({ name: "calculator-on-screen", state: "prohibited" })],
    });
    expect(set.tools).toEqual([]);
  });

  it("[T94] gives each on-screen tool of the profile a slot of the host", () => {
    const slots = new Map([
      ["dictionary-on-screen", "dictionary"],
      ["thesaurus-on-screen", "thesaurus"],
      ["homophone-checker-on-screen", "homophone-checker"],
      ["note-taking-on-screen", "note-taking"],
      ["visual-organizer-on-screen", "visual-organizer"],
      ["outliner-on-screen", "outliner"],
      ["peer-interaction-on-screen", "peer-interaction"],
      ["spell-checker-on-screen", "spell-checker"],
    ] as const);
    const set = resolveTools({ companion: null, supports: [...slots.keys()].map((name) => support({ name })) });
    expect(set.tools.map(({ spec }) => (spec.kind === "slot" ? spec.tool : spec.kind))).toEqual([...slots.values()]);
  });

  it("[T94] leaves out a prohibited support, whichever tool it is", () => {
    const set = resolveTools({
      companion: null,
      supports: [
        support({ name: "dictionary-on-screen", state: "prohibited" }),
        support({ name: "line-reader", state: "prohibited" }),
        support({ name: "answer-masking", state: "prohibited" }),
        support({ name: "thesaurus-on-screen" }),
      ],
    });
    expect(set.tools.map(({ spec }) => spec)).toEqual([{ kind: "slot", tool: "thesaurus" }]);
  });

  it("[T63] has no tools, and no physical materials, for an item without companion materials and a profile without supports", () => {
    expect(resolveTools({ companion: null, supports: [] })).toEqual({ tools: [], physical: [] });
  });

  it("[T63] orders the item's materials before the candidate's supports", () => {
    const set = resolveTools({
      companion: companion({ rules: [RULE_XML] }),
      supports: [support({ name: "line-reader" }), support({ name: "answer-masking" })],
    });
    expect(set.tools.map(({ spec }) => spec.kind)).toEqual(["rule", "line-reader", "answer-masking"]);
  });
});

describe("scale", () => {
  it("[T63] converts the units of INFO §8.27, §8.28, §8.39 and §8.40", () => {
    expect(millimeters("Millimeter")).toBe(1);
    expect(millimeters("Centimeter")).toBe(10);
    expect(millimeters("Meter")).toBe(1000);
    expect(millimeters("Kilometer")).toBe(1_000_000);
    expect(millimeters("Inch")).toBe(25.4);
    expect(millimeters("Foot")).toBeCloseTo(12 * 25.4, 9);
    expect(millimeters("Yard")).toBeCloseTo(36 * 25.4, 9);
    expect(millimeters("Mile")).toBeCloseTo(63_360 * 25.4, 6);
    expect(degrees("Degree")).toBe(1);
    expect(degrees("Minute") * 60).toBeCloseTo(1, 12);
    expect(degrees("Second") * 3600).toBeCloseTo(1, 12);
    expect(degrees("Radian")).toBeCloseTo(57.29577951308232, 12);
  });

  it("[T63] names every unit with a symbol", () => {
    expect(unitSymbol("Centimeter")).toBe("cm");
    expect(unitSymbol("Degree")).toBe("°");
    expect(unitSymbol("Radian")).toBe("rad");
  });

  it("[T63] lays out the rule of BPIG §3.7.8.2: ten meters, a tick every half meter and a number every meter", () => {
    const scale = ruleScale(RULE_SPEC, 600);
    expect(scale.lengthPx).toBeCloseTo(600, 9);
    expect(scale.unit).toBe("Meter");
    const majors = scale.ticks.filter(({ major }) => major);
    const minors = scale.ticks.filter(({ major }) => !major);
    expect(majors.map(({ at }) => at)).toEqual(Array.from({ length: 11 }, (_, index) => index * 1000));
    expect(minors.map(({ at }) => at)).toEqual(Array.from({ length: 10 }, (_, index) => index * 1000 + 500));
    expect(scale.ticks.filter(({ labelled }) => labelled)).toHaveLength(11);
    expect(scale.unitMm).toBe(1000);
  });

  it("[T63] draws a rule at the size of CSS units when it fits: ten centimeters are 377.95 CSS pixels", () => {
    const scale = ruleScale(
      {
        minimumLength: 10,
        minorIncrement: { value: 1, unit: "Millimeter" },
        majorIncrement: { value: 1, unit: "Centimeter" },
      },
      1000,
    );
    expect(CSS_PX_PER_MM).toBeCloseTo(3.7795275591, 9);
    expect(scale.pxPerMm).toBe(CSS_PX_PER_MM);
    expect(scale.lengthPx).toBeCloseTo(377.9527559, 6);
    expect(scale.ticks.filter(({ major }) => major)).toHaveLength(11);
    expect(scale.ticks.filter(({ major }) => !major)).toHaveLength(90);
  });

  it("[T63] shrinks a rule that does not fit, keeping its proportions", () => {
    const scale = ruleScale({ minimumLength: 10, majorIncrement: { value: 1, unit: "Centimeter" } }, 200);
    expect(scale.lengthPx).toBe(200);
    expect(scale.pxPerMm).toBeCloseTo(2, 12);
  });

  it("[T63] draws a rule in US units", () => {
    const scale = ruleScale(
      { minimumLength: 12, minorIncrement: { value: 0.25, unit: "Inch" }, majorIncrement: { value: 1, unit: "Inch" } },
      2000,
    );
    expect(scale.unit).toBe("Inch");
    expect(scale.ticks.filter(({ major }) => major)).toHaveLength(13);
    expect(scale.ticks.filter(({ major }) => !major)).toHaveLength(36);
  });

  it("[T63] has only major ticks when the item gives no minor increment, and none closer than the least distance", () => {
    const only = ruleScale({ minimumLength: 10, majorIncrement: { value: 1, unit: "Centimeter" } }, 1000);
    expect(only.ticks.every(({ major }) => major)).toBe(true);
    const crowded = ruleScale(
      {
        minimumLength: 10,
        minorIncrement: { value: 1, unit: "Millimeter" },
        majorIncrement: { value: 1, unit: "Centimeter" },
      },
      100,
    );
    expect(crowded.ticks.every(({ major }) => major)).toBe(true);
  });

  it("[T63] numbers every few major ticks when they are too close for a number each", () => {
    const scale = ruleScale({ minimumLength: 100, majorIncrement: { value: 1, unit: "Centimeter" } }, 500);
    const labelled = scale.ticks.filter(({ labelled: isLabelled }) => isLabelled);
    const spacing = (labelled[1]?.at ?? 0) - (labelled[0]?.at ?? 0);
    expect(spacing * scale.pxPerMm).toBeGreaterThanOrEqual(MIN_LABEL_PX);
    expect(labelled[0]?.at).toBe(0);
  });

  it("[T63] lays out the protractor of BPIG §3.7.8.3: a tick every degree and a number every five", () => {
    const { ticks, unit, unitDegrees } = protractorScale(PROTRACTOR_SPEC, 200);
    expect(unit).toBe("Degree");
    expect(unitDegrees).toBe(1);
    expect(ticks.filter(({ major }) => major).map(({ at }) => at)).toEqual(
      Array.from({ length: 37 }, (_, index) => index * 5),
    );
    expect(ticks.filter(({ major }) => !major)).toHaveLength(181 - 37);
  });

  it("[T63] leaves out the degree ticks of a small protractor, where they are closer than the least distance", () => {
    const { ticks } = protractorScale(PROTRACTOR_SPEC, 96);
    expect(ticks.every(({ major }) => major)).toBe(true);
  });

  it("[T63] lays out a protractor in radians: a major tick every half radian", () => {
    const { ticks, unit } = protractorScale({ majorIncrement: { value: 0.5, unit: "Radian" } }, 200);
    expect(unit).toBe("Radian");
    expect(ticks.map(({ at }) => at)).toHaveLength(7);
    expect(ticks[6]?.at).toBeCloseTo(3 * (180 / Math.PI), 9);
  });

  it("[T63] lays out a protractor in minutes and seconds without drawing every tick", () => {
    const { ticks } = protractorScale(
      { minorIncrement: { value: 1, unit: "Second" }, majorIncrement: { value: 1, unit: "Minute" } },
      200,
    );
    expect(ticks.length).toBeLessThanOrEqual((Math.PI * 200) / MIN_TICK_PX + 1);
    expect(ticks[0]).toEqual({ at: 0, major: true, labelled: true });
  });
});

describe("properties", () => {
  const unit = fc.constantFrom(...LENGTH_UNITS);
  const step = fc.record({ value: fc.double({ min: 1e-6, max: 1e6, noNaN: true }), unit });
  const rule = fc.record({ minimumLength: fc.integer({ min: 1, max: 1_000_000_000 }), majorIncrement: step });

  it("[T63] bounds the ticks of a rule by its length in pixels, whatever the increments are", () => {
    fc.assert(
      fc.property(
        rule,
        fc.option(step, { nil: undefined }),
        fc.integer({ min: 100, max: 2000 }),
        (base, minorIncrement, width) => {
          const scale = ruleScale({ ...base, minorIncrement }, width);
          expect(scale.lengthPx).toBeLessThanOrEqual(width * (1 + 1e-9));
          expect(scale.ticks.length).toBeLessThanOrEqual((2 * width) / MIN_TICK_PX + 4);
          const positions = scale.ticks.map(({ at }) => at);
          expect(
            positions.every(
              (at) => at >= 0 && at <= base.minimumLength * millimeters(base.majorIncrement.unit) * (1 + 1e-9),
            ),
          ).toBe(true);
          expect(scale.ticks.filter(({ labelled }) => labelled).every(({ major }) => major)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("[T63] draws a major tick at the origin of a scale", () => {
    fc.assert(
      fc.property(rule, (base) => {
        expect(ruleScale(base, 600).ticks[0]).toEqual({ at: 0, major: true, labelled: true });
      }),
    );
  });

  it("[T63] bounds the ticks of a protractor by the length of its arc", () => {
    const angle = fc.record({
      value: fc.double({ min: 1e-6, max: 1e6, noNaN: true }),
      unit: fc.constantFrom(...ANGLE_UNITS),
    });
    fc.assert(
      fc.property(
        angle,
        fc.option(angle, { nil: undefined }),
        fc.integer({ min: 96, max: 200 }),
        (majorIncrement, minorIncrement, radius) => {
          const { ticks } = protractorScale({ majorIncrement, minorIncrement }, radius);
          expect(ticks.length).toBeLessThanOrEqual((2 * Math.PI * radius) / MIN_TICK_PX + 4);
          expect(ticks.every(({ at }) => at >= 0 && at <= 180)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("[T63] resolves to tools with distinct keys, and the same tools the second time", () => {
    const names = fc.constantFrom(
      "line-reader",
      "answer-masking",
      "calculator-on-screen",
      "dictionary-on-screen",
      "spell-checker-on-screen",
    );
    const supports = fc.array(
      fc.record({
        name: names,
        state: fc.constantFrom("prohibited", "active", "option", "assigned"),
        active: fc.boolean(),
      }),
      { maxLength: 8 },
    );
    fc.assert(
      fc.property(supports, (list) => {
        const input: ToolsInput = { companion: companion({ rules: [RULE_XML] }), supports: list };
        const first = resolveTools(input);
        const keys = first.tools.map(({ key }) => key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(resolveTools(input)).toEqual(first);
        for (const { name } of list.filter(({ state }) => state === "prohibited")) {
          const stillOffered = list.some((other) => other.name === name && other.state !== "prohibited");
          if (!stillOffered) expect(first.tools.some(({ support: binding }) => binding?.name === name)).toBe(false);
        }
      }),
    );
  });
});
