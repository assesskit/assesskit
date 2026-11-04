import { buildOperatorCall, createScoringOperators, OPERATOR_DEFINITIONS } from "@assesskit/runtime/operators";
import type { VirtualKeyboardKeycap, VirtualKeyboardLayout } from "mathlive";
import { describe, expect, it } from "vitest";
import {
  buildKeyboardLayouts,
  type DecimalSeparator,
  INLINE_SHORTCUTS,
  selectStepWords,
} from "../src/math-entry/internal.js";

const readable = createScoringOperators().get(OPERATOR_DEFINITIONS.readable);

/** Whether the reader of `@assesskit/runtime/operators` reads a line, as an expression or, for `\pm` and lists, a solution set. */
function reads(latex: string, separator: DecimalSeparator): boolean {
  return (["expression", "solution-set"] as const).some((form) => {
    const call = buildOperatorCall(
      {
        operator: "readable",
        key: { kind: "expression", expression: form === "expression" ? "x" : "x=1", form, decimalSeparator: separator },
      },
      "RESPONSE",
    );
    const result = readable?.([{ cardinality: "single", baseType: "string", value: latex }], call);
    return result?.cardinality === "single" && result.value === true;
  });
}

/**
 * Whether a key's LaTeX reads where a key can be pressed: alone, after a number or a variable, before one, between two, or
 * as a bracket that a group opens or closes, with the template's slots filled as a candidate fills them: `#@`, what was
 * before, is `x`, and an empty slot is `2`.
 */
function readsInPlace(latex: string, separator: DecimalSeparator): boolean {
  const filled = latex.replaceAll("#@", "x").replaceAll("#?", "2").replaceAll("#0", "2");
  const between = [`x${filled}2`, `2${filled}2`, `x=2${filled}x=3`];
  const brackets = [`${filled}2)`, `(2${filled}`, `${filled}2]`, `[2${filled}`];
  const places = [filled, `2${filled}`, `x${filled}`, `${filled}x`, `${filled}2`, ...between, ...brackets];
  return places.some((place) => reads(place, separator));
}

/** The LaTeX that each key of a layout writes, and with the shift key down, from the keys that write LaTeX. */
function writtenBy(layout: VirtualKeyboardLayout): readonly string[] {
  const rows = "rows" in layout ? layout.rows : [];
  const written: string[] = [];
  const add = (keycap: string | Partial<VirtualKeyboardKeycap>): void => {
    if (typeof keycap === "string") {
      // A name in brackets is a key of MathLive that moves, deletes, shifts or separates, and writes nothing.
      if (!/^\[[a-z-0-9]+\]$/.test(keycap)) written.push(keycap);
      return;
    }
    const latex = keycap.insert ?? keycap.latex;
    if (latex !== undefined) written.push(latex);
    if (keycap.shift !== undefined) add(keycap.shift);
    for (const variant of typeof keycap.variants === "string" ? [] : (keycap.variants ?? [])) add(variant);
  };
  for (const row of rows) for (const keycap of row) add(keycap);
  return written;
}

describe("the keyboard", () => {
  it.each(["." as const, "," as const])(
    "writes with every key, shifted or not, LaTeX that the reader reads, with %s as the decimal mark",
    (separator) => {
      const layouts = buildKeyboardLayouts(separator);
      expect(layouts.map(({ label }) => label)).toEqual(["123", "f(x)", "abc", "αβγ"]);
      const written = layouts.flatMap(writtenBy);
      expect(written.length).toBeGreaterThan(100);
      expect(written.filter((latex) => !readsInPlace(latex, separator))).toEqual([]);
    },
  );

  it("writes the decimal mark with MathLive's command, which writes the comma as {,} after a digit", () => {
    const [numbers] = buildKeyboardLayouts(",");
    const keys = numbers !== undefined && "rows" in numbers ? numbers.rows.flat() : [];
    expect(keys).toContainEqual(
      expect.objectContaining({ label: ",", command: "performWithFeedback(insertDecimalSeparator)" }),
    );
    expect(keys).toContainEqual(expect.objectContaining({ latex: ",", shift: { latex: ";" } }));
  });

  it("has no key that writes what the reader leaves unread, such as an integral, a sum or the imaginary unit", () => {
    const written = buildKeyboardLayouts(".").flatMap(writtenBy).join(" ");
    for (const command of ["\\int", "\\sum", "\\imaginaryI", "\\infty", "\\placeholder"])
      expect(written).not.toContain(command);
  });
});

describe("the inline shortcuts", () => {
  it("write LaTeX that the reader reads", () => {
    const written = Object.values(INLINE_SHORTCUTS).map((shortcut) =>
      typeof shortcut === "string" ? shortcut : shortcut.value,
    );
    expect(written.filter((latex) => !readsInPlace(latex, "."))).toEqual([]);
  });

  it("write \\log for log, which MathLive writes as \\log_{}, and keep sqrt, pi, the functions, >=, <=, +- and or", () => {
    expect(INLINE_SHORTCUTS).toMatchObject({
      log: "\\log",
      sqrt: "\\sqrt{#?}",
      pi: "\\pi",
      sin: "\\sin",
      ln: "\\ln",
      ">=": "\\ge",
      "<=": "\\le",
      "+-": "\\pm",
      or: "\\lor",
    });
  });

  it("leave out MathLive's shortcuts of what the reader does not read", () => {
    for (const removed of ["oo", "infty", "ii", "sum", "int", "lim", "->", "NN", "&&"]) {
      expect(INLINE_SHORTCUTS, removed).not.toHaveProperty(removed);
    }
  });
});

describe("the words of worked steps", () => {
  it("are those of the item's language, English by default, each replaced by its property", () => {
    expect(selectStepWords("id-ID", {})).toEqual({
      step: "Langkah",
      addStep: "Tambah langkah",
      removeStep: "Hapus langkah",
    });
    expect(selectStepWords("zh", {})).toEqual({ step: "Step", addStep: "Add a step", removeStep: "Remove step" });
    expect(selectStepWords("zh", { stepLabel: "步骤", addStepLabel: "添加步骤" })).toEqual({
      step: "步骤",
      addStep: "添加步骤",
      removeStep: "Remove step",
    });
  });
});
