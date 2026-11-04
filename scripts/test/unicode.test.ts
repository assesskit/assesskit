import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGraphemeRuns,
  encodeRuns,
  parseBlocks,
  parseCategories,
  parseGraphemeBreakTest,
  parseProperty,
  renderBlocks,
  renderCategories,
  renderGraphemes,
  sha256,
  UNICODE_FILES,
} from "../unicode.ts";

const VALUES = resolve(import.meta.dirname, "../../packages/runtime/src/values");
const OPERATORS = resolve(import.meta.dirname, "../../packages/runtime/src/operators");

describe("sha256", () => {
  it("hashes the UTF-8 bytes of a text", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("parseBlocks", () => {
  const text = [
    "# Start Code..End Code; Block Name",
    "0000..007F; Basic Latin",
    "0080..00FF; Latin-1 Supplement",
    "0700..074F; Syriac  ",
    "",
    "FEFF..FEFF; Specials",
    "FFF0..FFFD; Specials",
  ].join("\n");

  it("reads the ranges and writes each name without its spaces", () => {
    expect(parseBlocks(text)).toEqual([
      { name: "BasicLatin", first: 0, last: 0x7f },
      { name: "Latin-1Supplement", first: 0x80, last: 0xff },
      { name: "Syriac", first: 0x700, last: 0x74f },
      { name: "Specials", first: 0xfeff, last: 0xfeff },
      { name: "Specials", first: 0xfff0, last: 0xfffd },
    ]);
  });

  it("refuses a line that is not a block", () => {
    expect(() => parseBlocks("0000-007F Basic Latin")).toThrow('Cannot read the block line "0000-007F Basic Latin".');
  });

  it("gives a name with several ranges one entry with all of them", () => {
    expect(renderBlocks(parseBlocks(text))).toMatch(
      /\["Specials", \[\s*\[0xfeff, 0xfeff\],\s*\[0xfff0, 0xfffd\],?\s*\]\]/,
    );
  });
});

describe("parseCategories", () => {
  const text = [
    "0000;<control>;Cc;0;BN;;;;;N;NULL;;;;",
    "0001;<control>;Cc;0;BN;;;;;N;START OF HEADING;;;;",
    "0020;SPACE;Zs;0;WS;;;;;N;;;;;",
    "0041;LATIN CAPITAL LETTER A;Lu;0;L;;;;;N;;;;0061;",
    "3400;<CJK Ideograph Extension A, First>;Lo;0;L;;;;;N;;;;;",
    "4DBF;<CJK Ideograph Extension A, Last>;Lo;0;L;;;;;N;;;;;",
  ].join("\n");

  it("covers every code point with runs of one category, and the code points the file omits are Cn", () => {
    expect(parseCategories(text)).toEqual([
      { category: "Cc", length: 2 }, // U+0000 and U+0001
      { category: "Cn", length: 30 }, // U+0002 to U+001F
      { category: "Zs", length: 1 }, // U+0020
      { category: "Cn", length: 32 }, // U+0021 to U+0040
      { category: "Lu", length: 1 }, // U+0041
      { category: "Cn", length: 0x3400 - 0x42 }, // U+0042 to U+33FF
      { category: "Lo", length: 0x4dbf - 0x3400 + 1 }, // the range of Extension A
      { category: "Cn", length: 0x110000 - 0x4dc0 }, // U+4DC0 to U+10FFFF
    ]);
  });

  it("joins neighbors of one category into a run", () => {
    const runs = parseCategories("0000;<control>;Cc;0;BN;;;;;N;;;;;\n0001;<control>;Cc;0;BN;;;;;N;;;;;\n");
    expect(runs[0]).toEqual({ category: "Cc", length: 2 });
  });

  it("refuses characters out of order and lines it cannot read", () => {
    expect(() => parseCategories("0002;A;Lu;\n0001;B;Lu;")).toThrow("The character 0001 is out of order.");
    expect(() => parseCategories("0001")).toThrow('Cannot read the character line "0001".');
  });
});

describe("encodeRuns", () => {
  it("writes a category and the length in base 36 for every run", () => {
    expect(
      encodeRuns([
        { category: "Cc", length: 2 },
        { category: "Cn", length: 35 },
        { category: "Lo", length: 36 },
      ]),
    ).toBe("Cc2 Cnz Lo10");
  });
});

describe("parseProperty", () => {
  const text = ["# A comment", "0600..0605    ; Prepend # Cf   [6] ARABIC NUMBER SIGN", "000D          ; CR", ""].join(
    "\n",
  );

  it("reads ranges and single code points with their values", () => {
    expect(parseProperty(text)).toEqual([
      { first: 0x600, last: 0x605, value: "Prepend" },
      { first: 0x0d, last: 0x0d, value: "CR" },
    ]);
  });

  it("reads the value of one property of a file of several", () => {
    const derived = "0915..0939    ; InCB; Consonant # Lo\n0300          ; Alphabetic # Mn";
    expect(parseProperty(derived, "InCB")).toEqual([{ first: 0x915, last: 0x939, value: "Consonant" }]);
  });

  it("refuses a line it cannot read", () => {
    expect(() => parseProperty("0600-0605 ; Prepend")).toThrow('Cannot read the property line "0600-0605 ; Prepend".');
  });
});

describe("buildGraphemeRuns", () => {
  it("codes each code point by its break, its conjunct break times 16 and 64 for a pictograph", () => {
    const runs = buildGraphemeRuns(
      [{ first: 0x0d, last: 0x0d, value: "CR" }],
      [{ first: 0x20, last: 0x20, value: "Extended_Pictographic" }],
      [{ first: 0x0d, last: 0x0d, value: "Linker" }],
    );
    expect(runs.slice(0, 5)).toEqual([
      { code: 0, length: 0x0d },
      { code: 1 + 16 * 2, length: 1 },
      { code: 0, length: 0x20 - 0x0e },
      { code: 64, length: 1 },
      { code: 0, length: 0x110000 - 0x21 },
    ]);
  });
});

describe("parseGraphemeBreakTest", () => {
  it("reads the clusters that the marks between code points give", () => {
    const line = "\u00f7 000D \u00d7 000A \u00f7 0308 \u00d7 200D \u00f7\t#  \u00f7 [0.2] <CARRIAGE RETURN (CR)>";
    expect(parseGraphemeBreakTest(`# A comment\n${line}\n`)).toEqual([
      {
        clusters: [
          [0x0d, 0x0a],
          [0x308, 0x200d],
        ],
      },
    ]);
  });
});

describe("generated files", () => {
  it("name the sources they were generated from, as pinned", () => {
    const blocks = readFileSync(resolve(VALUES, "unicode-blocks.ts"), "utf8");
    const categories = readFileSync(resolve(VALUES, "unicode-categories.ts"), "utf8");
    expect(blocks).toContain(`${UNICODE_FILES.blocks.url} (SHA-256 ${UNICODE_FILES.blocks.sha256})`);
    expect(categories).toContain(`${UNICODE_FILES.characters.url} (SHA-256 ${UNICODE_FILES.characters.sha256})`);
    const graphemes = readFileSync(resolve(OPERATORS, "unicode-graphemes.ts"), "utf8");
    for (const source of [UNICODE_FILES.graphemeBreaks, UNICODE_FILES.emoji, UNICODE_FILES.coreProperties])
      expect(graphemes).toContain(`${source.url} (SHA-256 ${source.sha256})`);
  });

  it("are rendered in the form that the package reads", () => {
    const runs = [{ category: "Cc", length: 2 }];
    expect(renderCategories(runs)).toContain('"Cc2"');
    expect(renderBlocks([{ name: "BasicLatin", first: 0, last: 0x7f }])).toContain('["BasicLatin", [[0x0, 0x7f]]]');
    expect(renderGraphemes([{ code: 33, length: 36 }])).toContain('"x:10"');
  });
});
