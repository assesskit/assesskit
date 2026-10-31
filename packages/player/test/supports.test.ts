import { readAsi } from "@assesskit/runtime/asi";
import { createEngine, type SupportView, stamp, viewFromJson, viewToJson } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { readPnp, SUPPORT_NAMES, type SupportName, type SupportSetting } from "@assesskit/runtime/pnp";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EN_MESSAGES, ID_MESSAGES } from "../src/index.js";
import { mediaScaleOf, presentationOf } from "../src/player/supports/appearance.js";
import { cardKindOf } from "../src/player/supports/cards.js";
import { checkSupportViews } from "../src/player/supports/check.js";
import { supportLabel } from "../src/player/supports/names.js";
import { checkPresentation } from "../src/player/supports/presentation.js";
import { TOOL_SUPPORT_NAMES } from "../src/player/tools/model.js";
import { fuzzJson } from "./fuzz.js";
import { onSupport, supportView } from "./supports-fixture.js";

const settings = <T extends SupportSetting>(setting: T): T => setting;

/** Passes input to a function as JSON delivers it, which TypeScript does not check. */
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

/** The entries of a map as a plain object, for a comparison with the table of the styling guide. */
const entries = (map: ReadonlyMap<string, string>): Record<string, string> => Object.fromEntries(map);

/** The look that a list of supports asks for, as plain objects. */
function lookOf(...supports: SupportView[]): {
  attributes: Record<string, string>;
  properties: Record<string, string>;
} {
  const { attributes, properties } = presentationOf(supports);
  return { attributes: entries(attributes), properties: entries(properties) };
}

const THEME_SUPPORTS: readonly [SupportName, SupportSetting | undefined][] = [
  ["high-contrast", { name: "high-contrast", replaceAccessModes: [] }],
  ["invert-display-polarity", { name: "invert-display-polarity", replaceAccessModes: [] }],
];

describe("check", () => {
  it("[T75] accepts the supports of a view as the runtime gives them, and after the JSON of the wire", () => {
    const supports = [
      onSupport("spoken", {
        name: "spoken",
        replaceAccessModes: [],
        restrictionTypes: ["word-by-word"],
        speechRate: 150,
      }),
      supportView("magnification", { state: "option", settings: { name: "magnification", replaceAccessModes: [] } }),
      supportView("ext:kxz-glossary", { state: "assigned" }),
    ];
    expect(() => checkSupportViews(supports, "The list of supports")).not.toThrow();
    expect(() => checkSupportViews(json(supports), "The list of supports")).not.toThrow();
    expect(() => checkSupportViews([], "The list of supports")).not.toThrow();
  });

  it("rejects a list or a support of the wrong type, in a full sentence", () => {
    const rejects = (value: unknown, message: string): void => {
      expect(() => checkSupportViews(json(value), "The list of supports")).toThrow(new DataError(message));
    };
    rejects({}, "The list of supports is invalid: expected an array, found an object.");
    rejects([null], "The list of supports is invalid at [0]: expected an object, found null.");
    rejects(
      [{ name: "spoken", state: "active" }],
      'The list of supports is invalid at [0]: missing the property "active".',
    );
    rejects(
      [{ name: "spoken", state: "active", active: true, extra: 1 }],
      'The list of supports is invalid at [0]: unexpected property "extra".',
    );
    rejects(
      [{ name: 5, state: "active", active: true }],
      "The list of supports is invalid at [0].name: expected the name of a support, found 5.",
    );
    rejects(
      [{ name: "ext:", state: "active", active: true }],
      'The list of supports is invalid at [0].name: expected the name of a support, found "ext:".',
    );
    rejects(
      [{ name: "spoken", state: "active", active: true, settings: [] }],
      "The list of supports is invalid at [0].settings: expected an object, found an array.",
    );
    rejects(
      [{ name: "spoken", state: "active", active: true, settings: { name: "braille" } }],
      'The list of supports is invalid at [0]: the settings must have the name "spoken" of their support, found "braille".',
    );
  });

  it("[T89] checks the settings that the player reads: colors, numbers, terms and flags", () => {
    const rejects = (settings: unknown, where: string, detail: string): void => {
      const { name } = settings as { name: string };
      expect(() =>
        checkSupportViews(json([{ name, state: "active", active: true, settings }]), "The list of supports"),
      ).toThrow(
        new DataError(`The list of supports is invalid at [0]: the settings are invalid at ${where}: ${detail}.`),
      );
    };
    const color = "expected a color as #RGB or #RRGGBB, found";
    rejects({ name: "text-appearance", fontColor: "red" }, "fontColor", `${color} "red"`);
    rejects({ name: "text-appearance", backgroundColor: 1 }, "backgroundColor", "expected a string, found 1");
    rejects({ name: "text-appearance", fontSize: "big" }, "fontSize", 'expected a number, found "big"');
    rejects({ name: "text-appearance", lineHeight: "2" }, "lineHeight", 'expected a number, found "2"');
    rejects(
      { name: "text-appearance", wordWrapping: false },
      "wordWrapping",
      "expected true when it is present, found false",
    );
    rejects(
      { name: "text-appearance", fontFace: { fontNames: [1] } },
      "fontFace.fontNames[0]",
      "expected a string, found 1",
    );
    rejects(
      { name: "text-appearance", fontFace: { fontNames: [], genericFontFace: "gothic" } },
      "fontFace.genericFontFace",
      'expected "serif", "sans serif", "monospaced", "cursive" or "fantasy", found "gothic"',
    );
    rejects({ name: "invert-display-polarity", foreground: "#12" }, "foreground", `${color} "#12"`);
    rejects({ name: "magnification", text: { zoomAmount: "2" } }, "text.zoomAmount", 'expected a number, found "2"');
    rejects({ name: "line-reader", highlightColor: "#ggg" }, "highlightColor", `${color} "#ggg"`);
    rejects(
      { name: "braille", deliveryMode: "loud" },
      "deliveryMode",
      'expected "refreshable" or "embossed", found "loud"',
    );
    rejects({ name: "long-description", hideVisually: "yes" }, "hideVisually", 'expected true or false, found "yes"');
    rejects({ name: "sign-language", language: "" }, "language", "expected a length of at least 1, found 0");
    rejects({ name: "language-of-interface", languages: {} }, "languages", "expected an array, found an object");
  });

  it("accepts colors as #RGB and #RRGGBB in either case", () => {
    for (const fontColor of ["#369", "#336699", "#AbCdEf"]) {
      const settings: SupportSetting = { name: "text-appearance", replaceAccessModes: [], fontColor };
      expect(() =>
        checkSupportViews([supportView("text-appearance", { settings })], "The list of supports"),
      ).not.toThrow();
    }
  });

  it("reads or refuses arbitrary JSON with a DataError, and nothing else", () => {
    const supports = [
      onSupport("spoken", {
        name: "spoken",
        replaceAccessModes: [],
        restrictionTypes: ["word-by-word"],
        speechRate: 150,
      }),
      supportView("magnification", { state: "option", settings: { name: "magnification", replaceAccessModes: [] } }),
      supportView("ext:kxz-glossary", { state: "assigned" }),
    ];
    fuzzJson((value) => checkSupportViews(value, "The list of supports"), [json(supports), []]);
  });
});

describe("appearance", () => {
  it("[T79][T87] sets the themes of the styling guide by the attribute, and nothing else", () => {
    // The table of docs/styling.md: high contrast is `data-ak-contrast="high"`, inverted polarity is `data-ak-polarity="inverted"`.
    expect(lookOf(onSupport("high-contrast"))).toEqual({
      attributes: { "data-ak-contrast": "high" },
      properties: {},
    });
    expect(lookOf(onSupport("invert-display-polarity"))).toEqual({
      attributes: { "data-ak-polarity": "inverted" },
      properties: {},
    });
    expect(lookOf(onSupport("high-contrast"), onSupport("invert-display-polarity")).attributes).toEqual({
      "data-ak-contrast": "high",
      "data-ak-polarity": "inverted",
    });
  });

  it("[T87] gives the colors of an inverted display to the properties", () => {
    const settings: SupportSetting = {
      name: "invert-display-polarity",
      replaceAccessModes: [],
      foreground: "#eee",
      background: "#112233",
    };
    expect(lookOf(onSupport("invert-display-polarity", settings))).toEqual({
      attributes: { "data-ak-polarity": "inverted" },
      properties: { "--ak-fg": "#eee", "--ak-bg": "#112233" },
    });
  });

  it("[T89] sets the text appearance: colors, size as a multiple of 12 points, face, spacing and flags", () => {
    const settings: SupportSetting = {
      name: "text-appearance",
      replaceAccessModes: [],
      fontColor: "#222222",
      backgroundColor: "#fffbe6",
      fontSize: 18,
      fontFace: { fontNames: ["Example Sans", 'Say "Hi"\\now'], genericFontFace: "sans serif" },
      lineHeight: 1.25,
      lineSpacing: 0.5,
      letterSpacing: 0.12,
      wordSpacing: 0.16,
      uniformFontSizing: true,
      wordWrapping: true,
    };
    expect(lookOf(onSupport("text-appearance", settings))).toEqual({
      attributes: { "data-ak-uniform-font": "", "data-ak-wrapping": "" },
      properties: {
        "--ak-fg": "#222222",
        "--ak-bg": "#fffbe6",
        // 18 points over the 12 points that the PNP schema gives as the default size.
        "--ak-font-scale": "1.5",
        "--ak-font-family": '"Example Sans", "Say \\"Hi\\"\\\\now", sans-serif',
        "--ak-line-height": "1.25",
        "--ak-line-spacing": "0.5",
        "--ak-letter-spacing": "0.12em",
        "--ak-word-spacing": "0.16em",
      },
    });
  });

  it("[T89] spells each generic font face as CSS does, and keeps a control character out of a name", () => {
    const face = (
      genericFontFace: "serif" | "sans serif" | "monospaced" | "cursive" | "fantasy",
      fontNames: string[] = [],
    ) =>
      lookOf(
        onSupport("text-appearance", {
          name: "text-appearance",
          replaceAccessModes: [],
          fontFace: { fontNames, genericFontFace },
        }),
      ).properties["--ak-font-family"];
    expect(["serif", "sans serif", "monospaced", "cursive", "fantasy"].map((name) => face(name as "serif"))).toEqual([
      "serif",
      "sans-serif",
      "monospace",
      "cursive",
      "fantasy",
    ]);
    expect(face("serif", ["A\nB;}"])).toBe('"A B;}", serif');
  });

  it("[T89] lets the colors of the text appearance win over those of inverted polarity", () => {
    const polarity: SupportSetting = {
      name: "invert-display-polarity",
      replaceAccessModes: [],
      foreground: "#eee",
      background: "#111",
    };
    const appearance: SupportSetting = { name: "text-appearance", replaceAccessModes: [], fontColor: "#ff0" };
    expect(
      lookOf(onSupport("text-appearance", appearance), onSupport("invert-display-polarity", polarity)).properties,
    ).toEqual({
      "--ak-fg": "#ff0",
      "--ak-bg": "#111",
    });
  });

  it("[T88] zooms the text by the amount of the magnification, and non-text content by its own", () => {
    const zoom = (settings: SupportSetting): ReturnType<typeof lookOf> => lookOf(onSupport("magnification", settings));
    const base = { name: "magnification", replaceAccessModes: [] } as const;
    expect(zoom({ ...base, allContent: { zoomAmount: 3 } }).properties).toEqual({ "--ak-text-zoom": "3" });
    expect(zoom({ ...base, text: { zoomAmount: 1.5 }, nonText: { zoomAmount: 4 } }).properties).toEqual({
      "--ak-text-zoom": "1.5",
    });
    // Only non-text content is enlarged: the text keeps its size.
    expect(zoom({ ...base, nonText: { zoomAmount: 4 } }).properties).toEqual({});
    expect(mediaScaleOf([onSupport("magnification", { ...base, allContent: { zoomAmount: 3 } })])).toBe(3);
    expect(
      mediaScaleOf([onSupport("magnification", { ...base, text: { zoomAmount: 2 }, nonText: { zoomAmount: 4 } })]),
    ).toBe(4);
    expect(mediaScaleOf([onSupport("magnification", { ...base, text: { zoomAmount: 2 } })])).toBe(1);
  });

  it("[T88] zooms to 200 percent when the magnification names no amount", () => {
    expect(lookOf(onSupport("magnification")).properties).toEqual({ "--ak-text-zoom": "2" });
    expect(
      lookOf(onSupport("magnification", { name: "magnification", replaceAccessModes: [], allContent: {} })).properties,
    ).toEqual({
      "--ak-text-zoom": "2",
    });
    expect(mediaScaleOf([onSupport("magnification")])).toBe(2);
  });

  it("[T88][T89] treats a size or a zoom of 0 or less as none, since it would show nothing", () => {
    const base = { name: "magnification", replaceAccessModes: [] } as const;
    expect(lookOf(onSupport("magnification", { ...base, allContent: { zoomAmount: 0 } })).properties).toEqual({
      "--ak-text-zoom": "2",
    });
    expect(mediaScaleOf([onSupport("magnification", { ...base, allContent: { zoomAmount: -3 } })])).toBe(2);
    const size = settings({ name: "text-appearance", replaceAccessModes: [], fontSize: -1 });
    expect(lookOf(onSupport("text-appearance", size)).properties).toEqual({});
  });

  it("[T90][T91] sets the single column and the keyword emphasis", () => {
    expect(lookOf(onSupport("layout-single-column")).attributes).toEqual({ "data-ak-single-column": "" });
    expect(lookOf(onSupport("keyword-emphasis")).attributes).toEqual({ "data-ak-keyword-emphasis": "" });
  });

  it("[T75] applies a support that is on, whatever its state, and no support that is off", () => {
    for (const state of ["active", "option", "assigned"] as const) {
      expect(lookOf(supportView("high-contrast", { state, active: true })).attributes).toEqual({
        "data-ak-contrast": "high",
      });
    }
    expect(lookOf(supportView("high-contrast", { state: "option", active: false }))).toEqual({
      attributes: {},
      properties: {},
    });
    expect(lookOf(supportView("high-contrast", { state: "prohibited", active: false }))).toEqual({
      attributes: {},
      properties: {},
    });
    expect(mediaScaleOf([supportView("magnification", { state: "option", active: false })])).toBe(1);
  });

  it("[T75] ignores the supports that change nothing of the look", () => {
    const others = SUPPORT_NAMES.filter(
      (name) =>
        ![
          "high-contrast",
          "invert-display-polarity",
          "text-appearance",
          "magnification",
          "layout-single-column",
          "keyword-emphasis",
        ].includes(name),
    ).map((name) => onSupport(name));
    expect(lookOf(...others)).toEqual({ attributes: {}, properties: {} });
    expect(mediaScaleOf(others)).toBe(1);
  });

  it("[T75] rejects supports that are not a list of the runtime's views", () => {
    expect(() => presentationOf(json({}))).toThrow(
      new DataError("The list of supports is invalid: expected an array, found an object."),
    );
    expect(() => mediaScaleOf(json([1]))).toThrow(
      new DataError("The list of supports is invalid at [0]: expected an object, found 1."),
    );
    expect(() => presentationOf(json(null))).toThrow(
      new DataError("The list of supports is invalid: expected an array, found null."),
    );
  });
});

describe("presentation", () => {
  it("accepts what presentationOf builds", () => {
    const look = presentationOf([onSupport("high-contrast"), onSupport("magnification")]);
    expect(() => checkPresentation(look, "The presentation")).not.toThrow();
  });

  it("rejects a presentation of the wrong type, a name it cannot set, or a value that is not text", () => {
    const rejects = (value: unknown, message: string): void => {
      expect(() => checkPresentation(value, "The option presentation")).toThrow(new DataError(message));
    };
    const empty = new Map<string, string>();
    rejects(null, "The option presentation must be an object with the maps attributes and properties, found null.");
    rejects({ attributes: empty }, "The option presentation property properties must be a Map, found undefined.");
    rejects(
      { attributes: {}, properties: empty },
      "The option presentation property attributes must be a Map, found an object.",
    );
    rejects(
      { attributes: new Map([["onclick", "x"]]), properties: empty },
      'The option presentation property attributes has the names data-ak-polarity, data-ak-contrast, data-ak-single-column, data-ak-keyword-emphasis, data-ak-uniform-font, data-ak-wrapping, found "onclick".',
    );
    rejects(
      { attributes: empty, properties: new Map([["--ak-fg", 1]]) },
      'The option presentation property properties must map "--ak-fg" to a string, found 1.',
    );
  });
});

describe("names", () => {
  it("[T75] names every predefined support except the ones that a tool of the toolbar turns on and off", () => {
    const unnamed = SUPPORT_NAMES.filter((name) => supportLabel(name, EN_MESSAGES) === undefined);
    expect([...unnamed].sort()).toEqual([...TOOL_SUPPORT_NAMES].sort());
  });

  it("names a support in the language of the interface, and a custom one by its local name (BPIG §5.4)", () => {
    expect(supportLabel("high-contrast", EN_MESSAGES)).toBe("High contrast");
    expect(supportLabel("high-contrast", ID_MESSAGES)).toBe("Kontras tinggi");
    expect(supportLabel("ext:kxztesting-illustrated-glossary-on-screen", EN_MESSAGES)).toBe(
      "kxztesting-illustrated-glossary-on-screen",
    );
  });
});

describe("cards", () => {
  it("[T76][T77][T78][T79][T80][T81][T82][T83][T84] shows each support that has a card the way the design asks for", () => {
    const kinds = new Map(
      SUPPORT_NAMES.flatMap((name) => (cardKindOf(name) === undefined ? [] : [[name, cardKindOf(name)] as const])),
    );
    expect(Object.fromEntries(kinds)).toEqual({
      "glossary-on-screen": "popup",
      "keyword-translation": "popup",
      "linguistic-guidance": "popup",
      "additional-directions": "popup",
      "keyboard-directions": "popup",
      "high-contrast": "replace",
      "simplified-graphics": "replace",
      "simplified-language-portions": "replace",
      "sign-language": "alongside",
      "audio-description": "alongside",
      transcript: "alongside",
      "long-description": "alongside",
      braille: "alongside",
      tactile: "alongside",
    });
    expect(cardKindOf("ext:anything")).toBe("popup");
  });
});

/** An item with a catalog and a profile whose supports the engine turns on and off. */
const ITEM = `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i" title="I" time-dependent="false">
  <qti-item-body><p>Hello.</p></qti-item-body></qti-assessment-item>`;

const PROFILE = `<access-for-all-pnp xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0pnp_v1p0">
  <spoken><reading-type>computer-read-aloud</reading-type></spoken>
  <magnification><all-content zoom-amount="2"/></magnification>
  <high-contrast/>
  <captions/>
  <activate-at-initialization-set><spoken/></activate-at-initialization-set>
  <activate-as-option-set><high-contrast/><captions/></activate-as-option-set>
  <prohibit-set><magnification/></prohibit-set>
</access-for-all-pnp>`;

describe("the support action and the runtime's engine", () => {
  const document = readAsi(ITEM);
  if (document.kind !== "item") throw new Error("Expected an item.");
  const engine = createEngine({ kind: "item", item: document.item, base: "item.xml" });
  const profile = readPnp(PROFILE);
  if (!("supports" in profile)) throw new Error("Expected one profile.");
  const started = engine.start({ seed: 1, at: 0, pnp: profile, universalSupports: ["encouragement"] });
  if (!started.ok) throw new Error(started.refusal.message);
  const state = started.state;

  const names = (supports: readonly SupportView[], filter: (support: SupportView) => boolean): SupportName[] =>
    supports.filter(filter).map(({ name }) => name);

  it("[T75] gives the supports with their state, the settings of the profile and none for a prohibited one", () => {
    const { supports } = engine.view(state, 1);
    expect(supports.find(({ name }) => name === "spoken")).toMatchObject({
      state: "active",
      active: true,
      settings: { name: "spoken", readingType: "computer-read-aloud" },
    });
    expect(supports.find(({ name }) => name === "magnification")).toEqual({
      name: "magnification",
      state: "prohibited",
      active: false,
    });
    expect(supports.find(({ name }) => name === "encouragement")).toEqual({
      name: "encouragement",
      state: "option",
      active: false,
    });
    expect(names(supports, ({ state: each }) => each === "option").sort()).toEqual([
      "captions",
      "encouragement",
      "high-contrast",
    ]);
  });

  it("[T75] turns an option on and off with the support action, and the next view says so", () => {
    const on = engine.apply(state, stamp(state, { type: "support", name: "high-contrast", active: true }, 10));
    if (!on.ok) throw new Error(on.refusal.message);
    expect(engine.view(on.state, 11).supports.find(({ name }) => name === "high-contrast")?.active).toBe(true);
    // The wire carries the view to the browser, and the panel and the presentation read it there.
    const wire = viewFromJson(JSON.parse(JSON.stringify(viewToJson(engine.view(on.state, 11)))));
    expect(lookOf(...wire.supports).attributes).toEqual({ "data-ak-contrast": "high" });
    const off = engine.apply(on.state, stamp(on.state, { type: "support", name: "high-contrast", active: false }, 12));
    if (!off.ok) throw new Error(off.refusal.message);
    expect(engine.view(off.state, 13).supports.find(({ name }) => name === "high-contrast")?.active).toBe(false);
  });

  it("[T75] refuses the action for a prohibited support and one that is on from the start, and leaves the state as it was", () => {
    for (const name of ["magnification", "spoken", "hazard-avoidance"] as const) {
      const step = engine.apply(state, stamp(state, { type: "support", name, active: false }, 10));
      expect(step.ok).toBe(false);
      if (!step.ok) expect(step.refusal.code).toBe("support-not-available");
    }
  });

  it("[T75] gives a panel of buttons for the options only: the supports that the engine lets the candidate turn", () => {
    const options = engine.view(state, 1).supports.filter(({ state: each }) => each === "option");
    for (const { name } of options) {
      const step = engine.apply(state, stamp(state, { type: "support", name, active: true }, 10));
      expect(step.ok, name).toBe(true);
    }
  });
});

describe("properties", () => {
  const supportArbitrary = fc.record({
    name: fc.constantFrom(...SUPPORT_NAMES),
    state: fc.constantFrom("prohibited", "active", "option", "assigned"),
    active: fc.boolean(),
  });

  it("[T75] builds the same valid presentation twice for any supports, and sets nothing for a list of supports that are off", () => {
    fc.assert(
      fc.property(fc.array(supportArbitrary, { maxLength: 12 }), (supports) => {
        const first = presentationOf(supports);
        expect(entries(first.attributes)).toEqual(entries(presentationOf(supports).attributes));
        expect(() => checkPresentation(first, "The presentation")).not.toThrow();
        const off = presentationOf(supports.map((support) => ({ ...support, active: false })));
        expect([off.attributes.size, off.properties.size]).toEqual([0, 0]);
        expect(mediaScaleOf(supports)).toBeGreaterThanOrEqual(1);
      }),
    );
  });

  it("[T75] gives the theme supports no property when no setting names a color", () => {
    for (const [name, settings] of THEME_SUPPORTS) {
      expect(lookOf(onSupport(name, settings)).properties).toEqual({});
    }
  });
});
