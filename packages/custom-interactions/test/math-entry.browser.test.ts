import type { ExpressionKey } from "@assesskit/runtime/keys";
import {
  buildOperatorCall,
  compareMathSteps,
  createScoringOperators,
  OPERATOR_DEFINITIONS,
} from "@assesskit/runtime/operators";
import { buildContainer, buildSingle, type Value } from "@assesskit/runtime/values";
import { describe, expect, it } from "vitest";
import { commands, userEvent } from "vitest/browser";
import type {} from "../../player/test/fixtures/commands.js";
import { waitFor } from "../../player/test/wait.js";
import { hitsOf, mount, ready, responseOf, scoreOf, stateOf } from "./fixtures/frame.js";
import { writeMathEntryItem, writeStepsItem } from "./fixtures/items.js";

/** The WCAG levels that axe checks, as the player's tests check them. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

const FULL = { cardinality: "single", baseType: "float", value: 1 } as const;
const NONE = { cardinality: "single", baseType: "float", value: 0 } as const;

const expression = (text: string, more: Partial<ExpressionKey> = {}): ExpressionKey => ({
  kind: "expression",
  expression: text,
  ...more,
});

/** Whether the `readable` operator reads a response as the key's expression. */
function isReadable(response: Value | null | undefined, key: ExpressionKey): boolean | undefined {
  const call = buildOperatorCall({ operator: "readable", key }, "RESPONSE");
  const result = createScoringOperators().get(OPERATOR_DEFINITIONS.readable)?.([response ?? null], call);
  return result?.cardinality === "single" && typeof result.value === "boolean" ? result.value : undefined;
}

/**
 * Keys that a candidate presses, what MathLive 0.111.1 writes for them through the item's shortcuts, and a key that the
 * response is equivalent to. `ArrowRight` leaves a fraction, a power or a root, as a candidate does.
 */
const TYPED: readonly {
  readonly keys: readonly string[];
  readonly latex: string;
  readonly key: ExpressionKey;
}[] = [
  { keys: ["2x+1"], latex: "2x+1", key: expression("1+2x") },
  { keys: ["3x^2", "ArrowRight", "-5x+6"], latex: "3x^2-5x+6", key: expression("6-5x+3x^2") },
  { keys: ["1/2", "ArrowRight"], latex: "\\frac12", key: expression("0.5") },
  {
    keys: ["(x+1)/(x-1)", "ArrowRight"],
    latex: "\\frac{\\left(x+1\\right)}{\\left(x-1\\right)}",
    key: expression("1+\\frac{2}{x-1}"),
  },
  { keys: ["sqrt(x)"], latex: "\\sqrt{\\left(x\\right)}", key: expression("\\sqrt x") },
  { keys: ["sin(x)"], latex: "\\sin\\left(x\\right)", key: expression("\\sin x") },
  { keys: ["tan(x)^2", "ArrowRight"], latex: "\\tan\\left(x\\right)^2", key: expression("\\frac{\\sin^2x}{\\cos^2x}") },
  {
    keys: ["log(x)"],
    latex: "\\log\\left(x\\right)",
    key: expression("\\frac{\\ln x}{\\ln10}", { variables: { x: { min: 0.5, max: 10 } } }),
  },
  { keys: ["log_2", "ArrowRight", "(8)"], latex: "\\log_2\\left(8\\right)", key: expression("3") },
  { keys: ["ee^x", "ArrowRight"], latex: "\\exponentialE^{x}", key: expression("e^x") },
  { keys: ["pi*r^2", "ArrowRight"], latex: "\\pi\\cdot r^2", key: expression("\\pi r^2") },
  { keys: ["x=+-3"], latex: "x=\\pm3", key: expression("x=3 \\lor x=-3", { form: "solution-set" }) },
  { keys: ["x=2 or x=3"], latex: "x=2\\lor x=3", key: expression("x=3 \\lor x=2", { form: "solution-set" }) },
  { keys: ["2x+3=7"], latex: "2x+3=7", key: expression("x=2", { form: "equation" }) },
  { keys: ["30deg"], latex: "30\\degree", key: expression("\\frac{\\pi}{6}") },
  { keys: ["50%"], latex: "50\\%", key: expression("\\frac12") },
  { keys: ["2xx3"], latex: "2\\times3", key: expression("6") },
  { keys: ["x^-1", "ArrowRight"], latex: "x^{-1}", key: expression("\\frac1x") },
  { keys: ["abs(x)"], latex: "abs\\left(x\\right)", key: expression("\\left|x\\right|") },
  {
    keys: ["cbrt(x)"],
    latex: "\\sqrt[3]{\\left(x\\right)}",
    key: expression("x^{\\frac13}", { variables: { x: { min: 0.5, max: 10 } } }),
  },
  // MathLive's own shortcut would write \infty, which the reader does not read; the item's shortcuts leave the letters.
  { keys: ["oo"], latex: "oo", key: expression("o^2") },
];

/** Mounts an item of one expression and waits for its interaction. */
async function mountExpression(key: ExpressionKey, title: string, attributes = "") {
  const xml = writeMathEntryItem(key, title, attributes);
  const mounted = mount(xml, { title });
  await ready(mounted);
  return { xml, mounted };
}

describe("math entry with real keys", () => {
  it.each(TYPED.map((entry, index) => ({ ...entry, index })))(
    "writes $latex for $keys, which the reader reads and expression-equivalent scores as its key",
    async ({ keys, latex, key, index }) => {
      const title = `Type the answer ${index}.`;
      const { xml, mounted } = await mountExpression(key, title);
      await commands.keysInFrame(title, "math-field", keys);
      const response = await responseOf(mounted);
      expect(response).toEqual(buildSingle("string", latex));
      expect(isReadable(response, key)).toBe(true);
      expect(scoreOf(xml, response ?? null)).toEqual(FULL);
    },
  );

  it("scores a wrong answer 0", async () => {
    const { xml, mounted } = await mountExpression(expression("2x+1"), "Type a wrong answer.");
    await commands.keysInFrame("Type a wrong answer.", "math-field", ["2x+2"]);
    const response = await responseOf(mounted);
    expect(response).toEqual(buildSingle("string", "2x+2"));
    expect(scoreOf(xml, response ?? null)).toEqual(NONE);
  });

  it("keeps an empty slot as \\placeholder{}, which the reader reports unreadable, and the item scores 0", async () => {
    const key = expression("1");
    const { xml, mounted } = await mountExpression(key, "Leave a slot empty.");
    await commands.keysInFrame("Leave a slot empty.", "math-field", ["2/"]);
    const response = await responseOf(mounted);
    expect(response).toEqual(buildSingle("string", "\\frac{2}{\\placeholder{}}"));
    expect(isReadable(response, key)).toBe(false);
    const call = buildOperatorCall({ operator: "expression-equivalent", key }, "RESPONSE");
    const equivalent = createScoringOperators().get(OPERATOR_DEFINITIONS["expression-equivalent"]);
    expect(equivalent?.([response ?? null], call)).toBeNull();
    expect(scoreOf(xml, response ?? null)).toEqual(NONE);
  });

  it("writes the decimal comma of an item whose data-decimal-separator is a comma as {,}", async () => {
    const key = expression("\\frac14", { decimalSeparator: "," });
    const { xml, mounted } = await mountExpression(key, "Type a quarter.", 'data-decimal-separator=","');
    await commands.keysInFrame("Type a quarter.", "math-field", ["0,25"]);
    const response = await responseOf(mounted);
    expect(response).toEqual(buildSingle("string", "0{,}25"));
    expect(isReadable(response, key)).toBe(true);
    expect(scoreOf(xml, response ?? null)).toEqual(FULL);
  });

  it("gives NULL until the candidate types, and after the candidate clears the field", async () => {
    const { mounted } = await mountExpression(expression("x"), "Type and clear.");
    expect(await responseOf(mounted)).toBeNull();
    await commands.keysInFrame("Type and clear.", "math-field", ["x", "Backspace"]);
    expect(await responseOf(mounted)).toBeNull();
  });
});

describe("math entry with the virtual keyboard", () => {
  /** The key of the visible layout whose accessible name is the LaTeX it writes. */
  const keycap = (latex: string): string => `.MLK__layer.is-visible .MLK__keycap[aria-label=${JSON.stringify(latex)}]`;
  const Right = `.MLK__layer.is-visible [data-command='"performWithFeedback(moveToNextChar)"']`;
  const Decimal = `.MLK__layer.is-visible [data-command='"performWithFeedback(insertDecimalSeparator)"']`;
  const tab = (label: string): string => `.MLK__layer.is-visible [data-layer]:has-text(${JSON.stringify(label)})`;

  it("shows the keyboard in the frame, which grows to hold it, and writes what its keys write", async () => {
    const key = expression("3.5+\\pi\\sin x");
    const title = "Tap the answer.";
    const { xml, mounted } = await mountExpression(key, title);
    const closed = mounted.frame.element.getBoundingClientRect().height;
    await commands.pressInFrame(title, "math-field");
    await commands.pressInFrame(title, "[part=virtual-keyboard-toggle]");
    await waitFor(() => expect(mounted.frame.element.getBoundingClientRect().height).toBeGreaterThan(closed + 100));
    for (const selector of [keycap("7"), keycap("a/b"), keycap("2"), Right, keycap("+"), keycap("\\pi")]) {
      await commands.pressInFrame(title, selector);
    }
    await commands.pressInFrame(title, tab("f(x)"));
    await commands.pressInFrame(title, keycap("\\sin"));
    await commands.pressInFrame(title, tab("abc"));
    await commands.pressInFrame(title, keycap("x"));
    const response = await responseOf(mounted);
    expect(response).toEqual(buildSingle("string", "\\frac72+\\pi\\sin x"));
    expect(scoreOf(xml, response ?? null)).toEqual(FULL);
  });

  it("writes the item's decimal comma with its decimal key, and an empty slot of a template as \\placeholder{}", async () => {
    const key = expression("2{,}5", { decimalSeparator: "," });
    const title = "Tap a decimal.";
    const { xml, mounted } = await mountExpression(key, title, 'data-decimal-separator=","');
    await commands.pressInFrame(title, "math-field");
    await commands.pressInFrame(title, "[part=virtual-keyboard-toggle]");
    for (const selector of [keycap("2"), Decimal, keycap("5")]) await commands.pressInFrame(title, selector);
    expect(await responseOf(mounted)).toEqual(buildSingle("string", "2{,}5"));
    expect(scoreOf(xml, (await responseOf(mounted)) ?? null)).toEqual(FULL);
    await commands.pressInFrame(title, keycap("\\sqrt{#0}"));
    const response = await responseOf(mounted);
    expect(response).toEqual(buildSingle("string", "2{,}5\\sqrt{\\placeholder{}}"));
    expect(isReadable(response, key)).toBe(false);
  });
});

describe("worked steps", () => {
  it("gives one line a step, ordered, which compareMathSteps checks line by line", async () => {
    const title = "Solve 2x + 3 = 7.";
    const mounted = mount(writeStepsItem(title), { title });
    await ready(mounted);
    await commands.keysInFrame(title, "math-field", ["2x+3=7", "Enter"]);
    await commands.keysInFrame(title, "math-field[aria-label='Step 2']", ["2x=4", "Enter"], false);
    await commands.keysInFrame(title, "math-field[aria-label='Step 3']", ["x=2"], false);
    const response = await responseOf(mounted);
    expect(response).toEqual(buildContainer("ordered", "string", ["2x+3=7", "2x=4", "x=2"]));
    const steps = response?.cardinality === "ordered" ? response.values.map(String) : [];
    expect(compareMathSteps(steps).map((check) => check?.equivalent ?? null)).toEqual([null, true, true]);
  });

  it("adds and removes lines with buttons named by the step, and leaves an empty line out of the response", async () => {
    const title = "Show your steps.";
    const mounted = mount(writeStepsItem(title), { title });
    await ready(mounted);
    await commands.keysInFrame(title, "math-field", ["x+x"]);
    await commands.pressInFrame(title, "button:has-text('Add a step')");
    await commands.pressInFrame(title, "button:has-text('Add a step')");
    await commands.keysInFrame(title, "math-field[aria-label='Step 3']", ["2x"]);
    expect(await responseOf(mounted)).toEqual(buildContainer("ordered", "string", ["x+x", "2x"]));
    await commands.pressInFrame(title, "button[aria-label='Remove step 1']");
    expect(await responseOf(mounted)).toEqual(buildContainer("ordered", "string", ["2x"]));
    expect(
      await commands.readInFrame(title, "[...document.querySelectorAll('math-field')].map((f) => f.ariaLabel)"),
    ).toEqual(["Step 1", "Step 2"]);
    expect(await stateOf(mounted)).toBe('["","2x"]');
  });

  it("words its buttons in the item's language, and in the words of the item's properties", async () => {
    const title = "Tunjukkan langkahmu.";
    const mounted = mount(writeStepsItem(title), { title, language: "id" });
    await ready(mounted);
    expect(
      await commands.readInFrame(
        title,
        "[...document.querySelectorAll('button, math-field')].map((e) => e.ariaLabel ?? e.textContent)",
      ),
    ).toEqual(["Langkah 1", "Hapus langkah 1", "Tambah langkah"]);
  });
});

describe("state and status", () => {
  it("restores the lines of the state it gave, and the response it is bound to when there is no state", async () => {
    const title = "Restore.";
    const xml = writeStepsItem(title);
    const restored = mount(xml, { title, state: '["a+b","",  "c"]' });
    await ready(restored);
    expect(
      await commands.readInFrame(title, "[...document.querySelectorAll('math-field')].map((f) => f.value)"),
    ).toEqual(["a+b", "", "c"]);
    await restored.frame.destroy();
    const bound = mount(xml, { title, value: buildContainer("ordered", "string", ["y=1", "y"]) });
    await ready(bound);
    expect(
      await commands.readInFrame(title, "[...document.querySelectorAll('math-field')].map((f) => f.value)"),
    ).toEqual(["y=1", "y"]);
  });

  it("takes no input in review and shows no buttons", async () => {
    const title = "Review.";
    const mounted = mount(writeStepsItem(title), {
      title,
      status: "review",
      value: buildContainer("ordered", "string", ["x=1"]),
    });
    await ready(mounted);
    expect(
      await commands.readInFrame(
        title,
        "[document.querySelector('math-field').readOnly, document.querySelectorAll('button').length]",
      ),
    ).toEqual([true, 0]);
  });

  it("refuses a data-decimal-separator that is neither . nor , and starts no interaction", async () => {
    const xml = writeMathEntryItem(expression("x"), "Bad mark.", 'data-decimal-separator=";"');
    const mounted = mount(xml, { title: "Bad mark." });
    await waitFor(() => expect(mounted.events).toContainEqual({ type: "failed", reason: "instance" }));
  });
});

describe("the frame", () => {
  it("loads the module and MathLive's fonts from the package, and nothing else", async () => {
    await commands.watchConsole();
    const { mounted } = await mountExpression(expression("x"), "Load from the package.");
    await commands.keysInFrame("Load from the package.", "math-field", ["x"]);
    await waitFor(async () =>
      expect(await hitsOf(mounted)).toContain("/modules/math-entry/fonts/KaTeX_Main-Regular.woff2"),
    );
    const hits = await hitsOf(mounted);
    expect(
      hits.filter((path) => !/^\/modules\/math-entry(?:\.js|\/fonts\/KaTeX_[A-Za-z0-9-]+\.woff2)$/.test(path)),
    ).toEqual([]);
    // The one error is the frame's own check that its policy is in force.
    expect((await commands.consoleErrors()).filter((error) => !error.includes("data:text/javascript,0"))).toEqual([]);
  });

  it("has no violation of WCAG 2.2 AA that axe finds, with one field and with steps, the keyboard shown", async () => {
    const { mounted } = await mountExpression(expression("x"), "One field.");
    await commands.pressInFrame("One field.", "math-field");
    await commands.pressInFrame("One field.", "[part=virtual-keyboard-toggle]");
    // The keyboard slides in; axe judges the colors once it is still.
    await waitFor(async () =>
      expect(
        await commands.readInFrame(
          "One field.",
          "[window.mathVirtualKeyboard.visible, document.getAnimations().length]",
        ),
      ).toEqual([true, 0]),
    );
    expect(await commands.axeInFrame("One field.", WCAG_TAGS)).toEqual([]);
    await mounted.frame.destroy();
    const steps = mount(writeStepsItem("Steps."), { title: "Steps." });
    await ready(steps);
    expect(await commands.axeInFrame("Steps.", WCAG_TAGS)).toEqual([]);
  });

  it("takes a keyboard only: Tab reaches the field from the page, and the keys type into it", async () => {
    const before = document.createElement("button");
    before.textContent = "Before";
    document.body.prepend(before);
    try {
      const { xml, mounted } = await mountExpression(expression("2x"), "Keyboard only.");
      before.focus();
      // Firefox stops at the frame itself before its content, as it does at any frame.
      const inField = async () =>
        (await commands.readInFrame("Keyboard only.", "document.activeElement?.tagName")) === "MATH-FIELD";
      for (let presses = 0; presses < 3 && !(await inField()); presses++) await userEvent.tab();
      await waitFor(async () => expect(await inField()).toBe(true));
      await userEvent.keyboard("x+x");
      const response = await responseOf(mounted);
      expect(response).toEqual(buildSingle("string", "x+x"));
      expect(scoreOf(xml, response ?? null)).toEqual(FULL);
    } finally {
      before.remove();
    }
  });
});
