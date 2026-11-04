import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DataError,
  deriveExtensionName,
  isColorTheme,
  isSetSupportName,
  isSupportName,
  type PersonalNeedsProfile,
  PNP_ALTERNATE_NAMESPACES,
  PNP_COLOR_THEMES,
  PNP_NAMESPACE,
  type PnpRecord,
  parseXml,
  readPnp,
  resolveSupports,
  SUPPORT_NAMES,
  type SupportSetting,
  writePnp,
  XSI_NAMESPACE,
} from "../src/index.js";
import { asProfile, personalNeedsProfile, pnpRecords } from "./arbitraries/pnp.js";
import { withoutPositions } from "./arbitraries/xml.js";
import { fuzzReader } from "./fuzz.js";
import { runGuideSamples } from "./guide-samples.js";
import { issueOf } from "./read-failure.js";

const SCHEMA_LOCATION = `${PNP_NAMESPACE} https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqtiv3p0_afa3p0pnp_v1p0.xsd`;
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

const profileDocument = (children: string, namespace = PNP_NAMESPACE): string =>
  `<access-for-all-pnp xmlns="${namespace}">${children}</access-for-all-pnp>`;

/** What `writePnp` writes for a profile whose elements are these. */
const written = (children: string): string => {
  const open = `<access-for-all-pnp xsi:schemaLocation="${SCHEMA_LOCATION}" xmlns="${PNP_NAMESPACE}" xmlns:xsi="${XSI_NAMESPACE}"`;
  return `${DECLARATION}${open}${children === "" ? "/>" : `>${children}</access-for-all-pnp>`}`;
};

const profileOf = (children: string, namespace = PNP_NAMESPACE): PersonalNeedsProfile =>
  asProfile(readPnp(profileDocument(children, namespace)));

/** Reads the elements of one support, expects its settings, and writes them back as the same elements. */
function expectSupport(elements: string, expected: SupportSetting): void {
  const profile = profileOf(elements);
  expect([...profile.supports]).toEqual([[expected.name, expected]]);
  expect(writePnp(profile)).toBe(written(elements));
}

const MODES = "<replace-access-mode-auditory/><replace-access-mode-textual/>";

describe("support names", () => {
  it("lists the 40 supports of the QTI profile, each once", () => {
    // The elements of AccessForAllPNPDType in the PNP schema, apart from the three sets and the wildcard.
    const fromSchema = [
      "hazard-avoidance",
      "input-requirements",
      "language-of-interface",
      "linguistic-guidance",
      "keyword-emphasis",
      "keyword-translation",
      "simplified-language-portions",
      "simplified-graphics",
      "item-translation",
      "sign-language",
      "encouragement",
      "additional-testing-time",
      "line-reader",
      "invert-display-polarity",
      "magnification",
      "spoken",
      "tactile",
      "braille",
      "answer-masking",
      "keyboard-directions",
      "additional-directions",
      "long-description",
      "captions",
      "environment",
      "transcript",
      "alternative-text",
      "audio-description",
      "high-contrast",
      "layout-single-column",
      "text-appearance",
      "calculator-on-screen",
      "dictionary-on-screen",
      "glossary-on-screen",
      "thesaurus-on-screen",
      "homophone-checker-on-screen",
      "note-taking-on-screen",
      "visual-organizer-on-screen",
      "outliner-on-screen",
      "peer-interaction-on-screen",
      "spell-checker-on-screen",
    ];
    expect([...SUPPORT_NAMES].sort()).toEqual([...fromSchema].sort());
  });

  it("lets a set list every support but hazard-avoidance and environment", () => {
    expect(SUPPORT_NAMES.filter(isSetSupportName)).toHaveLength(38);
    expect(isSetSupportName("hazard-avoidance")).toBe(false);
    expect(isSetSupportName("environment")).toBe(false);
    expect(isSetSupportName("spoken")).toBe(true);
    expect(isSetSupportName("ext:vendor")).toBe(false);
  });

  it("names a custom support by ext: and the local name of its element", () => {
    expect(deriveExtensionName("kxztesting-illustrated-glossary-on-screen")).toBe(
      "ext:kxztesting-illustrated-glossary-on-screen",
    );
    expect(isSupportName("ext:kxztesting-illustrated-glossary-on-screen")).toBe(true);
    expect(isSupportName("spoken")).toBe(true);
    for (const name of ["ext:", "Spoken", "", "spoken ", json("null"), json("5")])
      expect(isSupportName(name), String(name)).toBe(false);
    expect(() => deriveExtensionName(json("5"))).toThrow(
      "The local name of a custom support must be a string, found 5.",
    );
  });
});

describe("supports", () => {
  it("hazard-avoidance: one element for each hazard, from the vocabulary or an extension", () => {
    expectSupport(
      "<hazard-avoidance>flashing</hazard-avoidance><hazard-avoidance>olfactory-hazard</hazard-avoidance><hazard-avoidance>ext:vendor.glare</hazard-avoidance>",
      { name: "hazard-avoidance", hazards: ["flashing", "olfactory-hazard", "ext:vendor.glare"] },
    );
    for (const hazard of ["flashing", "sound", "olfactory-hazard", "motion-simulation"]) {
      expect(profileOf(`<hazard-avoidance>${hazard}</hazard-avoidance>`).supports.get("hazard-avoidance")).toEqual({
        name: "hazard-avoidance",
        hazards: [hazard],
      });
    }
  });

  it("input-requirements: full keyboard or mouse control, or an extension", () => {
    expectSupport("<input-requirements>full-keyboard-control</input-requirements>", {
      name: "input-requirements",
      requirement: "full-keyboard-control",
    });
    expectSupport("<input-requirements>full-mouse-control</input-requirements>", {
      name: "input-requirements",
      requirement: "full-mouse-control",
    });
    expectSupport("<input-requirements>ext:switch.access</input-requirements>", {
      name: "input-requirements",
      requirement: "ext:switch.access",
    });
  });

  it("language-of-interface: one element for each language, with the modes it replaces", () => {
    expectSupport(
      `<language-of-interface xml:lang="es"/><language-of-interface xml:lang="en">${MODES}</language-of-interface>`,
      {
        name: "language-of-interface",
        languages: [
          { language: "es", replaceAccessModes: [] },
          { language: "en", replaceAccessModes: ["auditory", "textual"] },
        ],
      },
    );
  });

  it("the supports that only replace content name the access modes", () => {
    const names = [
      "linguistic-guidance",
      "keyword-emphasis",
      "simplified-language-portions",
      "simplified-graphics",
      "encouragement",
      "tactile",
      "answer-masking",
      "keyboard-directions",
      "additional-directions",
      "captions",
      "transcript",
      "alternative-text",
      "audio-description",
      "high-contrast",
      "layout-single-column",
    ] as const;
    for (const name of names) {
      expectSupport(`<${name}/>`, { name, replaceAccessModes: [] });
      expectSupport(`<${name}>${MODES}</${name}>`, { name, replaceAccessModes: ["auditory", "textual"] });
    }
  });

  it("the ten access modes are replace-access-mode- and a mode (PNP XSD ReplacesAccessModeDType)", () => {
    const modes = [
      "auditory",
      "color",
      "item-size",
      "olfactory",
      "orientation",
      "position",
      "tactile",
      "text-on-image",
      "textual",
      "visual",
    ] as const;
    expectSupport(`<captions>${modes.map((mode) => `<replace-access-mode-${mode}/>`).join("")}</captions>`, {
      name: "captions",
      replaceAccessModes: modes,
    });
  });

  it("keyword-translation: the language of the translation of keywords", () => {
    expectSupport('<keyword-translation xml:lang="es"/>', {
      name: "keyword-translation",
      language: "es",
      replaceAccessModes: [],
    });
  });

  it("item-translation: the language of the translated item", () => {
    expectSupport('<item-translation xml:lang="ko"/>', {
      name: "item-translation",
      language: "ko",
      replaceAccessModes: [],
    });
  });

  it("sign-language: the sign language, such as American Sign Language, ase", () => {
    expectSupport(`<sign-language xml:lang="ase">${MODES}</sign-language>`, {
      name: "sign-language",
      language: "ase",
      replaceAccessModes: ["auditory", "textual"],
    });
  });

  it("additional-testing-time: unlimited, a multiplier or fixed minutes", () => {
    expectSupport("<additional-testing-time><unlimited/></additional-testing-time>", {
      name: "additional-testing-time",
      replaceAccessModes: [],
      time: { kind: "unlimited" },
    });
    expectSupport("<additional-testing-time><time-multiplier>1.5</time-multiplier></additional-testing-time>", {
      name: "additional-testing-time",
      replaceAccessModes: [],
      time: { kind: "time-multiplier", multiplier: 1.5 },
    });
    expectSupport(`<additional-testing-time>${MODES}<fixed-minutes>30</fixed-minutes></additional-testing-time>`, {
      name: "additional-testing-time",
      replaceAccessModes: ["auditory", "textual"],
      time: { kind: "fixed-minutes", minutes: 30 },
    });
  });

  it("line-reader: the color of the highlight", () => {
    expectSupport('<line-reader highlight-color="#336699"/>', {
      name: "line-reader",
      replaceAccessModes: [],
      highlightColor: "#336699",
    });
    expectSupport("<line-reader/>", { name: "line-reader", replaceAccessModes: [] });
    expectSupport('<line-reader highlight-color="#fa0"/>', {
      name: "line-reader",
      replaceAccessModes: [],
      highlightColor: "#fa0",
    });
  });

  it("invert-display-polarity: the foreground and the background color", () => {
    expectSupport('<invert-display-polarity foreground="#FFFFFF" background="#000"/>', {
      name: "invert-display-polarity",
      replaceAccessModes: [],
      foreground: "#FFFFFF",
      background: "#000",
    });
  });

  it("magnification: the zoom of all content, or of text and of non-text", () => {
    expectSupport('<magnification><text zoom-amount="1.5"/><non-text zoom-amount="2"/></magnification>', {
      name: "magnification",
      replaceAccessModes: [],
      text: { zoomAmount: 1.5 },
      nonText: { zoomAmount: 2 },
    });
    expectSupport('<magnification><all-content zoom-amount="3"/></magnification>', {
      name: "magnification",
      replaceAccessModes: [],
      allContent: { zoomAmount: 3 },
    });
    expectSupport("<magnification><all-content/></magnification>", {
      name: "magnification",
      replaceAccessModes: [],
      allContent: {},
    });
  });

  it("spoken: the reading type, the restrictions and the voice", () => {
    expectSupport("<spoken><reading-type>screen-reader</reading-type></spoken>", {
      name: "spoken",
      replaceAccessModes: [],
      restrictionTypes: [],
      readingType: "screen-reader",
    });
    expectSupport(
      `<spoken>${MODES}<reading-type>computer-read-aloud</reading-type><restriction-type>skip-math-equations</restriction-type><restriction-type>ext:iowa.reading</restriction-type><speech-rate>180</speech-rate><pitch>0.5</pitch><volume>0.8</volume><link-indication>speak-link</link-indication><typing-echo>characters-and-words</typing-echo></spoken>`,
      {
        name: "spoken",
        replaceAccessModes: ["auditory", "textual"],
        readingType: "computer-read-aloud",
        restrictionTypes: ["skip-math-equations", "ext:iowa.reading"],
        speechRate: 180,
        pitch: 0.5,
        volume: 0.8,
        linkIndication: "speak-link",
        typingEcho: "characters-and-words",
      },
    );
  });

  it("spoken: accepts every term of reading-type, restriction-type, link-indication and typing-echo", () => {
    const read = (child: string): unknown => profileOf(`<spoken>${child}</spoken>`).supports.get("spoken");
    for (const term of ["screen-reader", "computer-read-aloud"])
      expect(read(`<reading-type>${term}</reading-type>`)).toMatchObject({ readingType: term });
    for (const term of [
      "unrestricted",
      "word-by-word",
      "directions-only",
      "skip-math-equations",
      "skip-chemistry-equations",
    ]) {
      expect(read(`<restriction-type>${term}</restriction-type>`)).toMatchObject({ restrictionTypes: [term] });
    }
    for (const term of ["speak-link", "different-voice", "sound-effect", "none"]) {
      expect(read(`<link-indication>${term}</link-indication>`)).toMatchObject({ linkIndication: term });
    }
    for (const term of ["characters", "words", "characters-and-words", "none"]) {
      expect(read(`<typing-echo>${term}</typing-echo>`)).toMatchObject({ typingEcho: term });
    }
  });

  it("braille: the delivery, grade and kind of braille and of its mathematics", () => {
    expectSupport(
      `<braille xml:lang="en-US">${MODES}<delivery-mode>embossed</delivery-mode><grade>2</grade><braille-type>ueb</braille-type><math-type>nemeth</math-type></braille>`,
      {
        name: "braille",
        replaceAccessModes: ["auditory", "textual"],
        language: "en-US",
        deliveryMode: "embossed",
        grade: 2,
        brailleType: "ueb",
        mathType: "nemeth",
      },
    );
    expectSupport(
      "<braille><braille-type>ext:vendor.code</braille-type><math-type>ext:vendor.math</math-type></braille>",
      {
        name: "braille",
        replaceAccessModes: [],
        brailleType: "ext:vendor.code",
        mathType: "ext:vendor.math",
      },
    );
    for (const [element, term] of [
      ["delivery-mode", "refreshable"],
      ["braille-type", "ebae"],
      ["math-type", "ueb"],
    ] as const) {
      expect(profileOf(`<braille><${element}>${term}</${element}></braille>`).supports.size).toBe(1);
    }
    for (const grade of ["1", "3"]) {
      expect(profileOf(`<braille><grade>${grade}</grade></braille>`).supports.get("braille")).toMatchObject({
        grade: Number(grade),
      });
    }
  });

  it("long-description: whether it is hidden from sighted candidates, true unless said", () => {
    expectSupport('<long-description hide-visually="false"/>', {
      name: "long-description",
      replaceAccessModes: [],
      hideVisually: false,
    });
    expectSupport('<long-description hide-visually="true"/>', {
      name: "long-description",
      replaceAccessModes: [],
      hideVisually: true,
    });
    expectSupport("<long-description/>", { name: "long-description", replaceAccessModes: [] });
  });

  it("environment: the description, medical needs, software, hardware and breaks", () => {
    // BPIG's example lists the parameters in another order than the schema's sequence; the order of a choice is free.
    const profile = profileOf(
      "<environment><breaks>true</breaks><description>Candidate requires a room with low-levels of lighting.</description><medical>Candidate will bring an EPI pen for their bee sting allergy.</medical></environment>",
    );
    expect(profile.supports.get("environment")).toEqual({
      name: "environment",
      replaceAccessModes: [],
      description: "Candidate requires a room with low-levels of lighting.",
      medical: "Candidate will bring an EPI pen for their bee sting allergy.",
      breaks: true,
    });
    expectSupport(
      "<environment><software>screen reader</software><hardware>large monitor</hardware><breaks>false</breaks></environment>",
      {
        name: "environment",
        replaceAccessModes: [],
        software: "screen reader",
        hardware: "large monitor",
        breaks: false,
      },
    );
  });

  it("text-appearance: reads every term of the color theme of the guide, and writes none", () => {
    expect(PNP_COLOR_THEMES).toHaveLength(14);
    for (const term of PNP_COLOR_THEMES) {
      const profile = profileOf(`<text-appearance><color-theme>${term}</color-theme></text-appearance>`);
      expect(profile.supports.get("text-appearance")).toEqual({
        name: "text-appearance",
        replaceAccessModes: [],
        colorTheme: term,
      });
      expect(writePnp(profile)).toBe(written("<text-appearance/>"));
    }
  });

  it("text-appearance: an empty color theme asks only for the choice, and reads as the default", () => {
    expect(profileOf("<text-appearance><color-theme/></text-appearance>").supports.get("text-appearance")).toEqual({
      name: "text-appearance",
      replaceAccessModes: [],
      colorTheme: "default",
    });
  });

  it("text-appearance: a color theme of a program is ext: and at most 256 characters, hyphens too", () => {
    const longest = `ext:${"a".repeat(256)}`;
    for (const term of ["ext:school-green", longest]) {
      const profile = profileOf(`<text-appearance><color-theme> ${term} </color-theme></text-appearance>`);
      expect(profile.supports.get("text-appearance")).toMatchObject({ colorTheme: term });
    }
    for (const text of ["ext:", `${longest}a`, "pink-black", "yellow blue"]) {
      const document = `<text-appearance><color-theme>${text}</color-theme></text-appearance>`;
      expect(issueOf(() => profileOf(document)).rule, text).toBe("assesskit/pnp/invalid-text");
    }
    expect(["black-cream", "ext:school-green", longest].map(isColorTheme)).toEqual([true, true, true]);
    const others: unknown[] = JSON.parse('[null, 5, " default", "ext: ", {}, "default "]');
    expect(others.map(isColorTheme)).toEqual(others.map(() => false));
  });

  it("text-appearance: refuses the empty parameters of the guide, which the schema gives a type", () => {
    for (const name of ["font-size", "font-color", "background-color", "line-spacing", "word-spacing"]) {
      const document = `<text-appearance><${name}/></text-appearance>`;
      expect(issueOf(() => profileOf(document)).rule, name).toBe("assesskit/pnp/invalid-text");
    }
  });

  it("text-appearance: colors, size, face, spacing and wrapping", () => {
    expectSupport(
      `<text-appearance>${MODES}<background-color>#FFFF00</background-color><font-color>#000</font-color><font-size>18</font-size><font-face><font-name>Helvetica</font-name><font-name>Arial</font-name><generic-font-face>sans serif</generic-font-face></font-face><line-spacing>1.5</line-spacing><line-height>2</line-height><letter-spacing>0.1</letter-spacing><uniform-font-sizing/><word-spacing>0.2</word-spacing><word-wrapping/></text-appearance>`,
      {
        name: "text-appearance",
        replaceAccessModes: ["auditory", "textual"],
        backgroundColor: "#FFFF00",
        fontColor: "#000",
        fontSize: 18,
        fontFace: { fontNames: ["Helvetica", "Arial"], genericFontFace: "sans serif" },
        lineSpacing: 1.5,
        lineHeight: 2,
        letterSpacing: 0.1,
        uniformFontSizing: true,
        wordSpacing: 0.2,
        wordWrapping: true,
      },
    );
    for (const face of ["serif", "sans serif", "monospaced", "cursive", "fantasy"]) {
      expect(
        profileOf(
          `<text-appearance><font-face><generic-font-face>${face}</generic-font-face></font-face></text-appearance>`,
        ).supports.get("text-appearance"),
      ).toMatchObject({
        fontFace: { fontNames: [], genericFontFace: face },
      });
    }
  });

  it("calculator-on-screen: the kind of calculator, from the vocabulary or an extension", () => {
    expectSupport('<calculator-on-screen calculator-type="scientific"/>', {
      name: "calculator-on-screen",
      calculatorType: "scientific",
    });
    expectSupport('<calculator-on-screen calculator-type="ext:vendor.cas"/>', {
      name: "calculator-on-screen",
      calculatorType: "ext:vendor.cas",
    });
    expectSupport("<calculator-on-screen/>", { name: "calculator-on-screen" });
    for (const type of ["basic", "standard", "scientific", "graphing"]) {
      expect(
        profileOf(`<calculator-on-screen calculator-type="${type}"/>`).supports.get("calculator-on-screen"),
      ).toEqual({
        name: "calculator-on-screen",
        calculatorType: type,
      });
    }
  });

  it("the on-screen tools have no parameter", () => {
    for (const name of [
      "dictionary-on-screen",
      "glossary-on-screen",
      "thesaurus-on-screen",
      "homophone-checker-on-screen",
      "note-taking-on-screen",
      "visual-organizer-on-screen",
      "outliner-on-screen",
      "peer-interaction-on-screen",
      "spell-checker-on-screen",
    ] as const) {
      expectSupport(`<${name}/>`, { name });
    }
  });

  it("keeps the supports in the order of the document", () => {
    const profile = profileOf('<spoken/><captions/><item-translation xml:lang="es"/>');
    expect([...profile.supports.keys()]).toEqual(["spoken", "captions", "item-translation"]);
  });
});

describe("sets", () => {
  it("activate-as-option-set: the supports to offer as options, by name alone", () => {
    const profile = profileOf(
      '<sign-language xml:lang="ase"/><activate-as-option-set><sign-language/></activate-as-option-set>',
    );
    expect([...profile.activateAsOption]).toEqual(["sign-language"]);
    expect(profile.supports.get("sign-language")).toMatchObject({ language: "ase" });
    expect(writePnp(profile)).toBe(
      written('<sign-language xml:lang="ase"/><activate-as-option-set><sign-language/></activate-as-option-set>'),
    );
  });

  it("activate-at-initialization-set: the supports to have on from the start", () => {
    const profile = profileOf(
      "<spoken><reading-type>computer-read-aloud</reading-type></spoken><additional-testing-time><unlimited/></additional-testing-time><activate-at-initialization-set><spoken/></activate-at-initialization-set>",
    );
    expect([...profile.activateAtInitialization]).toEqual(["spoken"]);
    expect([...profile.supports.keys()]).toEqual(["spoken", "additional-testing-time"]);
  });

  it("prohibit-set: the supports that the candidate must not have", () => {
    const profile = profileOf(
      "<additional-testing-time><unlimited/></additional-testing-time><prohibit-set><magnification/><answer-masking/><text-appearance/></prohibit-set>",
    );
    expect([...profile.prohibited]).toEqual(["magnification", "answer-masking", "text-appearance"]);
    expect(writePnp(profile)).toBe(
      written(
        "<additional-testing-time><unlimited/></additional-testing-time><prohibit-set><magnification/><answer-masking/><text-appearance/></prohibit-set>",
      ),
    );
  });

  it("writes the three sets in the order of the schema and leaves out an empty one", () => {
    const profile = profileOf(
      "<prohibit-set><captions/></prohibit-set><activate-as-option-set><spoken/></activate-as-option-set><activate-at-initialization-set><braille/></activate-at-initialization-set>",
    );
    expect(writePnp(profile)).toBe(
      written(
        "<activate-at-initialization-set><braille/></activate-at-initialization-set><activate-as-option-set><spoken/></activate-as-option-set><prohibit-set><captions/></prohibit-set>",
      ),
    );
    expect(profileOf("<prohibit-set/>").prohibited.size).toBe(0);
    expect(writePnp(profileOf("<prohibit-set/>"))).toBe(written(""));
  });

  it("lists the supports of a set in the order of the document, and the same support in several sets", () => {
    const profile = profileOf(
      "<activate-as-option-set><tactile/><spoken/></activate-as-option-set><prohibit-set><spoken/></prohibit-set>",
    );
    expect([...profile.activateAsOption]).toEqual(["tactile", "spoken"]);
    expect([...profile.prohibited]).toEqual(["spoken"]);
  });
});

describe("resolving supports", () => {
  it("resolves a support that a profile assigns, and is in no set, as assigned", () => {
    const states = resolveSupports(profileOf('<item-translation xml:lang="ko"/>'));
    expect([...states]).toEqual([["item-translation", "assigned"]]);
  });

  it("resolves the sets: initialization is active, option is option, prohibit is prohibited", () => {
    const states = resolveSupports(
      profileOf(
        "<spoken/><activate-at-initialization-set><spoken/><captions/></activate-at-initialization-set><activate-as-option-set><tactile/></activate-as-option-set><prohibit-set><magnification/></prohibit-set>",
      ),
    );
    expect([...states]).toEqual([
      ["spoken", "active"],
      ["tactile", "option"],
      ["captions", "active"],
      ["magnification", "prohibited"],
    ]);
  });

  it("resolves a prohibited support as prohibited even if the profile assigns it: a prohibited support is not assigned", () => {
    const states = resolveSupports(profileOf("<magnification/><prohibit-set><magnification/></prohibit-set>"));
    expect(states.get("magnification")).toBe("prohibited");
  });

  it("lets prohibit win over initialization, and initialization over option", () => {
    const states = resolveSupports(
      profileOf(
        "<activate-as-option-set><spoken/><captions/><tactile/></activate-as-option-set><activate-at-initialization-set><spoken/><captions/></activate-at-initialization-set><prohibit-set><spoken/></prohibit-set>",
      ),
    );
    expect(Object.fromEntries(states)).toEqual({ spoken: "prohibited", captions: "active", tactile: "option" });
  });

  it("names a custom support by ext: and the local name of its element, and assigns it", () => {
    const profile = profileOf(
      '<spoken/><kxz:kxztesting-illustrated-glossary-on-screen xmlns:kxz="http://www.kxztesting.com/2019/pnp-extensions"/>',
    );
    expect([...resolveSupports(profile)]).toEqual([
      ["spoken", "assigned"],
      ["ext:kxztesting-illustrated-glossary-on-screen", "assigned"],
    ]);
  });

  it("leaves out a support that the profile does not mention", () => {
    expect(resolveSupports(profileOf("")).size).toBe(0);
  });
});

describe("extensions", () => {
  it("keeps the custom supports of other namespaces as elements", () => {
    const profile = profileOf(
      '<kxz:kxztesting-illustrated-glossary-on-screen xmlns:kxz="http://www.kxztesting.com/2019/pnp-extensions"/>',
    );
    expect(withoutPositions(profile.extensions)).toEqual([
      {
        kind: "element",
        namespace: "http://www.kxztesting.com/2019/pnp-extensions",
        name: "kxztesting-illustrated-glossary-on-screen",
        prefix: "kxz",
        attributes: [
          {
            namespace: "http://www.w3.org/2000/xmlns/",
            prefix: "xmlns",
            name: "kxz",
            value: "http://www.kxztesting.com/2019/pnp-extensions",
          },
        ],
        children: [],
      },
    ]);
    expect(writePnp(profile)).toContain(
      '<kxz:kxztesting-illustrated-glossary-on-screen xmlns:kxz="http://www.kxztesting.com/2019/pnp-extensions"/></access-for-all-pnp>',
    );
  });
});

describe("namespaces", () => {
  it("reads the two namespaces that 1EdTech's own documents use, and writes the schema's", () => {
    expect(PNP_ALTERNATE_NAMESPACES).toEqual([
      "http://www.imsglobal.org/xsd/qtiv3p0/imsafa3p0pnp_v1p0",
      "http://www.imsglobal.org/xsd/qt/qtiv3p0/imsafa3p0pnp_v1p0",
    ]);
    for (const namespace of PNP_ALTERNATE_NAMESPACES) {
      const profile = profileOf(
        '<line-reader highlight-color="#336699"/><prohibit-set><captions/></prohibit-set>',
        namespace,
      );
      expect(writePnp(profile)).toBe(
        written('<line-reader highlight-color="#336699"/><prohibit-set><captions/></prohibit-set>'),
      );
    }
  });

  it("reads a bulk file in either of the other namespaces", () => {
    for (const namespace of PNP_ALTERNATE_NAMESPACES) {
      const records = readPnp(
        `<access-for-all-pnp-records xmlns="${namespace}"><access-for-all-pnp-record><person-sourced-id source-system="S">1</person-sourced-id><access-for-all-pnp><captions/></access-for-all-pnp></access-for-all-pnp-record></access-for-all-pnp-records>`,
      );
      expect(records).toHaveLength(1);
    }
  });

  it("refuses the namespace of QTI 2.x documents and a document in no namespace", () => {
    expect(
      issueOf(() => readPnp('<access-for-all-pnp xmlns="http://www.imsglobal.org/xsd/imsafa3p0pnp_v1p0"/>')),
    ).toMatchObject({
      rule: "assesskit/pnp/not-pnp",
    });
    expect(() => readPnp("<access-for-all-pnp/>")).toThrow("found access-for-all-pnp in no namespace.");
  });
});

describe("bulk files", () => {
  const Bulk = `<access-for-all-pnp-records xmlns="${PNP_NAMESPACE}"><access-for-all-pnp-record><person-sourced-id source-system="IMSGlobalExamples">111</person-sourced-id><access-for-all-pnp><keyword-translation xml:lang="es"/><line-reader highlight-color="#336699"/></access-for-all-pnp></access-for-all-pnp-record><access-for-all-pnp-record><person-sourced-id source-system="IMSGlobalExamples">1000001</person-sourced-id><appointment-id>g8alg12345</appointment-id><appointment-id>g8ela12345</appointment-id><access-for-all-pnp><answer-masking/></access-for-all-pnp></access-for-all-pnp-record></access-for-all-pnp-records>`;

  it("reads a bulk file: a candidate and their appointments for each profile", () => {
    const records = readPnp(Bulk) as readonly PnpRecord[];
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      personSourcedId: { sourceSystem: "IMSGlobalExamples", id: "111" },
      appointmentIds: [],
    });
    expect([...(records[0]?.profile.supports.keys() ?? [])]).toEqual(["keyword-translation", "line-reader"]);
    expect(records[1]).toMatchObject({
      personSourcedId: { sourceSystem: "IMSGlobalExamples", id: "1000001" },
      appointmentIds: ["g8alg12345", "g8ela12345"],
    });
  });

  it("writes the records back in the same document", () => {
    expect(writePnp(readPnp(Bulk) as readonly PnpRecord[])).toBe(
      `${DECLARATION}${Bulk.replace(`<access-for-all-pnp-records xmlns="${PNP_NAMESPACE}">`, `<access-for-all-pnp-records xsi:schemaLocation="${SCHEMA_LOCATION}" xmlns="${PNP_NAMESPACE}" xmlns:xsi="${XSI_NAMESPACE}">`)}`,
    );
  });

  it("tells a single profile from a bulk file by the root element", () => {
    expect(Array.isArray(readPnp(profileDocument("")))).toBe(false);
    expect(Array.isArray(readPnp(Bulk))).toBe(true);
  });

  it("refuses a bulk file without records and a record without a candidate or a profile", () => {
    const records = (inner: string): string =>
      `<access-for-all-pnp-records xmlns="${PNP_NAMESPACE}">${inner}</access-for-all-pnp-records>`;
    expect(issueOf(() => readPnp(records("")))).toMatchObject({
      rule: "assesskit/pnp/missing-element",
      message: "The element access-for-all-pnp-records needs an access-for-all-pnp-record.",
    });
    expect(() =>
      readPnp(records("<access-for-all-pnp-record><access-for-all-pnp/></access-for-all-pnp-record>")),
    ).toThrow(
      "The element access-for-all-pnp-record needs the element person-sourced-id, found the element access-for-all-pnp.",
    );
    expect(() =>
      readPnp(
        records(
          '<access-for-all-pnp-record><person-sourced-id source-system="S">1</person-sourced-id></access-for-all-pnp-record>',
        ),
      ),
    ).toThrow("needs the element access-for-all-pnp, found no more elements.");
    expect(() =>
      readPnp(
        records(
          "<access-for-all-pnp-record><person-sourced-id>1</person-sourced-id><access-for-all-pnp/></access-for-all-pnp-record>",
        ),
      ),
    ).toThrow("The element person-sourced-id needs the attribute source-system.");
  });
});

describe("errors", () => {
  it("refuses a root that is neither of the two, naming the namespace", () => {
    expect(issueOf(() => readPnp(`<profile xmlns="${PNP_NAMESPACE}"/>`))).toEqual({
      severity: "error",
      rule: "assesskit/pnp/not-pnp",
      message: `The root element must be access-for-all-pnp or access-for-all-pnp-records in the namespace ${PNP_NAMESPACE}, found profile.`,
      location: { line: 1, column: 1, element: "profile" },
    });
  });

  it("refuses an element that is no support and no set, and an element in no namespace", () => {
    expect(() => profileOf("<color-theme>yellow</color-theme>")).toThrow(
      "The element color-theme is neither a predefined support nor a set.",
    );
    expect(() =>
      readPnp(`<access-for-all-pnp xmlns="${PNP_NAMESPACE}"><spoken xmlns=""/></access-for-all-pnp>`),
    ).toThrow("The element spoken in no namespace is not an extension: an extension is in a namespace of its own.");
  });

  it("refuses a support or a set that occurs twice, and a parameter that occurs twice", () => {
    expect(issueOf(() => profileOf("<spoken/><spoken/>"))).toMatchObject({
      rule: "assesskit/pnp/repeated-element",
      message: "The support spoken occurs more than once; the schema allows it once.",
    });
    expect(() => profileOf("<prohibit-set/><prohibit-set/>")).toThrow("The set prohibit-set occurs more than once");
    expect(() => profileOf("<spoken><pitch>1</pitch><pitch>2</pitch></spoken>")).toThrow(
      "The element pitch is repeated, or conflicts with another parameter of the support",
    );
    expect(() => profileOf("<captions><replace-access-mode-color/><replace-access-mode-color/></captions>")).toThrow(
      "The element replace-access-mode-color is repeated.",
    );
    expect(() =>
      profileOf("<additional-testing-time><unlimited/><fixed-minutes>5</fixed-minutes></additional-testing-time>"),
    ).toThrow("The element fixed-minutes is repeated, or conflicts");
    expect(() => profileOf("<magnification><all-content/><text/></magnification>")).toThrow(
      "The element magnification has either all-content, or text and non-text.",
    );
  });

  it("refuses additional-testing-time without any of its three ways", () => {
    expect(() => profileOf("<additional-testing-time/>")).toThrow(
      "The element additional-testing-time needs time-multiplier, fixed-minutes or unlimited.",
    );
  });

  it("refuses a language support without xml:lang or with a malformed tag", () => {
    expect(() => profileOf('<item-translation lang="ko"/>')).toThrow(
      "The element item-translation needs the attribute xml:lang.",
    );
    expect(() => profileOf('<sign-language xml:lang="american sign"/>')).toThrow("is not a language tag");
    expect(() => profileOf("<language-of-interface/>")).toThrow("needs the attribute xml:lang");
  });

  it("refuses a value outside the vocabulary or the type of its parameter", () => {
    expect(() => profileOf("<hazard-avoidance>loud</hazard-avoidance>")).toThrow(
      'A hazard must be one of "flashing", "sound", "olfactory-hazard", "motion-simulation", or ext: and letters, found "loud".',
    );
    expect(() => profileOf("<hazard-avoidance>ext:with-hyphen</hazard-avoidance>")).toThrow("or ext: and letters");
    expect(() => profileOf("<input-requirements>mouse</input-requirements>")).toThrow(
      "An input requirement must be one of",
    );
    expect(() => profileOf("<spoken><reading-type>robot</reading-type></spoken>")).toThrow(
      'A reading type must be "screen-reader" or "computer-read-aloud", found "robot".',
    );
    expect(() => profileOf("<spoken><speech-rate>fast</speech-rate></spoken>")).toThrow(
      'The text "fast" is not an integer',
    );
    expect(() => profileOf("<spoken><volume>1.5</volume></spoken>")).toThrow('The volume "1.5" is above 1.');
    expect(() => profileOf("<spoken><pitch>INF</pitch></spoken>")).toThrow("is not a finite decimal number");
    expect(() => profileOf('<line-reader highlight-color="red"/>')).toThrow(
      'The text "red" is not a color such as #336699 or #369.',
    );
    expect(() => profileOf("<braille><grade>4</grade></braille>")).toThrow(
      'A braille grade must be "1", "2" or "3", found "4".',
    );
    expect(() => profileOf('<long-description hide-visually="maybe"/>')).toThrow(
      'The text "maybe" is not true, false, 1 or 0.',
    );
    expect(() =>
      profileOf("<additional-testing-time><fixed-minutes>9007199254740993</fixed-minutes></additional-testing-time>"),
    ).toThrow("is not an integer from -9007199254740991 to 9007199254740991");
    expect(() => profileOf('<magnification><text zoom-amount="big"/></magnification>')).toThrow(
      "is not a finite decimal number",
    );
  });

  it("refuses a parameter that the support does not have, an element of another namespace in a support, and text in an empty one", () => {
    expect(() => profileOf("<spoken><grade>2</grade></spoken>")).toThrow(
      "The element grade is not a parameter of the support spoken.",
    );
    expect(() => profileOf('<captions><x:note xmlns:x="urn:x"/></captions>')).toThrow(
      "The element {urn:x}note is not a parameter of the support captions.",
    );
    expect(() => profileOf("<dictionary-on-screen>text</dictionary-on-screen>")).toThrow(
      "The element dictionary-on-screen has text, but it contains elements only.",
    );
    expect(() => profileOf('<dictionary-on-screen mode="x"/>')).toThrow("has the attribute mode");
    expect(() => profileOf("<spoken><reading-type>screen-reader<b/></reading-type></spoken>")).toThrow(
      "The element reading-type has the element b, but it contains text only.",
    );
  });

  it("refuses in a set what a set cannot list: hazard-avoidance, environment, a parameter, an unknown name, a repeat and a custom support", () => {
    expect(issueOf(() => profileOf("<prohibit-set><hazard-avoidance/></prohibit-set>"))).toMatchObject({
      rule: "assesskit/pnp/unexpected-element",
      message:
        "The element hazard-avoidance cannot be listed in the set prohibit-set: a set lists predefined supports other than hazard-avoidance and environment.",
    });
    expect(() => profileOf("<prohibit-set><environment/></prohibit-set>")).toThrow(
      "cannot be listed in the set prohibit-set",
    );
    expect(() => profileOf("<prohibit-set><unknown/></prohibit-set>")).toThrow("cannot be listed");
    expect(() => profileOf('<prohibit-set><x:custom xmlns:x="urn:x"/></prohibit-set>')).toThrow(
      "The element {urn:x}custom cannot be listed",
    );
    expect(() => profileOf("<prohibit-set><captions/><captions/></prohibit-set>")).toThrow(
      "The set prohibit-set lists captions twice.",
    );
    expect(() => profileOf("<prohibit-set><spoken><pitch>1</pitch></spoken></prohibit-set>")).toThrow(
      "The element pitch is not allowed in spoken at this place.",
    );
  });

  it("refuses input that is not text, bytes or an element", () => {
    expect(() => readPnp(json("null"))).toThrow(
      "The PNP to read must be a string, a Uint8Array or an XmlElement, found null.",
    );
    expect(() => readPnp(parseXml("<a/>"))).toThrow("found a in no namespace.");
  });

  it("refuses a profile that is not one", () => {
    const profile = profileOf("");
    expect(() => writePnp(json("null"))).toThrow("A profile must be an object, found null.");
    expect(() => writePnp({ ...profile, supports: json("{}") })).toThrow(
      "The supports of a profile must be a Map, found an object.",
    );
    expect(() => writePnp({ ...profile, prohibited: json("[]") })).toThrow(
      "The prohibited of a profile must be a Set, found an array.",
    );
    expect(() => writePnp({ ...profile, extensions: json("null") })).toThrow(
      "The extensions of a profile must be an array, found null.",
    );
    expect(() =>
      writePnp({
        ...profile,
        extensions: json('[{"kind":"element","namespace":"","name":"x","attributes":[],"children":[]}]'),
      }),
    ).toThrow("must hold elements of a namespace other than the PNP namespace");
    expect(() => writePnp({ ...profile, prohibited: new Set(json('["hazard-avoidance"]')) })).toThrow(
      'The prohibited of a profile lists predefined supports that a set can hold, found "hazard-avoidance".',
    );
    expect(() => writePnp({ ...profile, supports: new Map(json('[["loud",{"name":"loud"}]]')) })).toThrow(
      'The supports of a profile are named as predefined supports, found "loud".',
    );
    expect(() => resolveSupports(json("null"))).toThrow(DataError);
  });

  it("refuses settings whose name differs from their key, and settings that are not an object", () => {
    const profile = profileOf("");
    const mismatched = new Map<never, never>(json('[["spoken",{"name":"captions","replaceAccessModes":[]}]]'));
    expect(() => writePnp({ ...profile, supports: mismatched })).toThrow(
      'The support under the key "spoken" has the name "captions"; they must be the same.',
    );
    expect(() => writePnp({ ...profile, supports: new Map<never, never>(json('[["spoken",5]]')) })).toThrow(
      "The settings of the support spoken must be an object, found 5.",
    );
  });

  it("refuses settings with a list that is empty or has a term outside its vocabulary", () => {
    const write = (setting: unknown): string => {
      const name = (setting as { name: never }).name;
      return writePnp({ ...profileOf(""), supports: new Map([[name, setting as never]]) });
    };
    expect(() => write({ name: "hazard-avoidance", hazards: [] })).toThrow(
      "The hazards of hazard-avoidance needs at least one entry.",
    );
    expect(() => write({ name: "hazard-avoidance", hazards: ["loud"] })).toThrow('A hazard must be one of "flashing"');
    expect(() => write({ name: "hazard-avoidance", hazards: [" flashing"] })).toThrow(
      "must not have white space around it",
    );
    expect(() => write({ name: "language-of-interface", languages: [] })).toThrow(
      "The languages of language-of-interface needs at least one entry.",
    );
    expect(() => write({ name: "captions", replaceAccessModes: ["smell"] })).toThrow(
      'A mode in The replaceAccessModes of captions must be "auditory"',
    );
    expect(() => write({ name: "captions", replaceAccessModes: ["color", "color"] })).toThrow("must not repeat a mode");
    expect(() => write({ name: "captions", replaceAccessModes: "color" })).toThrow('must be an array, found "color"');
    expect(() => write({ name: "item-translation", language: "en_US", replaceAccessModes: [] })).toThrow(
      'The language of item-translation must be a language tag such as en or pt-BR, found "en_US".',
    );
  });

  it("refuses settings with a parameter of the wrong type or value", () => {
    const write = (setting: unknown): string => {
      const name = (setting as { name: never }).name;
      return writePnp({ ...profileOf(""), supports: new Map([[name, setting as never]]) });
    };
    const spoken = (fields: object): unknown => ({
      name: "spoken",
      replaceAccessModes: [],
      restrictionTypes: [],
      ...fields,
    });
    expect(() => write({ name: "additional-testing-time", replaceAccessModes: [], time: { kind: "forever" } })).toThrow(
      'The kind of the time of additional-testing-time must be "time-multiplier", "fixed-minutes" or "unlimited", found "forever".',
    );
    expect(() =>
      write({
        name: "additional-testing-time",
        replaceAccessModes: [],
        time: { kind: "time-multiplier", multiplier: Number.NaN },
      }),
    ).toThrow("The time multiplier must be a finite number, found NaN.");
    expect(() =>
      write({ name: "additional-testing-time", replaceAccessModes: [], time: { kind: "fixed-minutes", minutes: 1.5 } }),
    ).toThrow("The fixed minutes must be a safe integer, found 1.5.");
    expect(() => write({ name: "additional-testing-time", replaceAccessModes: [], time: 5 })).toThrow(
      "The time of additional-testing-time must be an object, found 5.",
    );
    expect(() => write({ name: "magnification", replaceAccessModes: [], allContent: {}, text: {} })).toThrow(
      "A magnification has either allContent, or text and nonText.",
    );
    expect(() => write(spoken({ volume: 2 }))).toThrow("The volume must be at most 1, found 2.");
    expect(() => write(spoken({ speechRate: "fast" }))).toThrow(
      'The speech rate must be a safe integer, found "fast".',
    );
    expect(() => write(spoken({ readingType: "robot" }))).toThrow(
      'The reading type must be "screen-reader" or "computer-read-aloud", found "robot".',
    );
    expect(() => write(spoken({ restrictionTypes: ["ext:with-digit1"] }))).toThrow("A restriction type must be one of");
    expect(() => write({ name: "braille", replaceAccessModes: [], grade: 4 })).toThrow(
      "The braille grade must be 1, 2 or 3, found 4.",
    );
    expect(() => write({ name: "line-reader", replaceAccessModes: [], highlightColor: "red" })).toThrow(
      'The highlight color must be a color such as #336699 or #369, found "red".',
    );
    expect(() => write({ name: "long-description", replaceAccessModes: [], hideVisually: "no" })).toThrow(
      'The hideVisually of long-description must be a boolean, found "no".',
    );
    expect(() => write({ name: "environment", replaceAccessModes: [], description: 5 })).toThrow(
      "The description of environment must be a string, found 5.",
    );
    expect(() => write({ name: "text-appearance", replaceAccessModes: [], uniformFontSizing: false })).toThrow(
      "The parameter uniform-font-sizing must be true or absent, found false.",
    );
    expect(() => write({ name: "text-appearance", replaceAccessModes: [], colorTheme: json("5") })).toThrow(
      "The color theme must be a term of color-theme, found 5.",
    );
    expect(() => write({ name: "text-appearance", replaceAccessModes: [], fontFace: json("5") })).toThrow(
      "The fontFace of text-appearance must be an object, found 5.",
    );
    expect(() => write({ name: "text-appearance", replaceAccessModes: [], fontFace: { fontNames: [5] } })).toThrow(
      "A font name must be a string, found 5.",
    );
    expect(() => write({ name: "calculator-on-screen", calculatorType: "abacus" })).toThrow(
      "The calculator type must be one of",
    );
  });

  it("refuses records that are not records, and an empty bulk file", () => {
    const profile = profileOf("");
    expect(() => writePnp([])).toThrow("A bulk PNP file needs at least one record.");
    expect(() => writePnp(json("[5]"))).toThrow("A PNP record must be an object, found 5.");
    expect(() => writePnp(json('[{"personSourcedId":5}]'))).toThrow(
      "The personSourcedId of a PNP record must be an object, found 5.",
    );
    expect(() =>
      writePnp([{ personSourcedId: { sourceSystem: "S", id: "1" }, appointmentIds: json("null"), profile }]),
    ).toThrow("The appointmentIds of a PNP record must be an array, found null.");
    expect(() =>
      writePnp([{ personSourcedId: { sourceSystem: json("5"), id: "1" }, appointmentIds: [], profile }]),
    ).toThrow("The sourceSystem of a person must be a string, found 5.");
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = new URL("../../../docs/runtime/pnp.md", import.meta.url);
    const pnp = await import("../src/pnp/index.js");
    expect(await runGuideSamples(guide, { "@assesskit/runtime/pnp": pnp })).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  it("reads back the profile that it writes", () => {
    fc.assert(
      fc.property(personalNeedsProfile({ extensions: true }), (model) => {
        expect(withoutPositions(readPnp(writePnp(model)))).toEqual(model);
      }),
      { numRuns: 300 },
    );
  });

  it("reads back the records that it writes", () => {
    fc.assert(
      fc.property(pnpRecords, (model) => {
        expect(withoutPositions(readPnp(writePnp(model)))).toEqual(model);
      }),
      { numRuns: 100 },
    );
  });

  it("reads a mutated document or refuses it with a ReadError or a SecurityError, and throws nothing else", () => {
    fuzzReader(personalNeedsProfile({ extensions: true }).map(writePnp), readPnp);
  });

  it("writes the same text for a profile that it has read as for the profile it was read from", () => {
    fc.assert(
      fc.property(personalNeedsProfile({ extensions: true }), (model) => {
        const text = writePnp(model);
        expect(writePnp(asProfile(readPnp(text)))).toBe(text);
      }),
      { numRuns: 200 },
    );
  });

  it("resolves every support a profile mentions exactly once, and a prohibited one as prohibited", () => {
    fc.assert(
      fc.property(personalNeedsProfile({ extensions: true }), (model) => {
        const states = resolveSupports(model);
        const mentioned = new Set<string>([
          ...model.supports.keys(),
          ...model.activateAsOption,
          ...model.activateAtInitialization,
          ...model.prohibited,
          ...model.extensions.map(({ name }) => deriveExtensionName(name)),
        ]);
        expect(new Set(states.keys())).toEqual(mentioned);
        for (const name of model.prohibited) expect(states.get(name)).toBe("prohibited");
        for (const name of model.activateAtInitialization) {
          if (!model.prohibited.has(name)) expect(states.get(name)).toBe("active");
        }
      }),
      { numRuns: 200 },
    );
  });
});
