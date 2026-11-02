import type { CalculatorInfo } from "@assesskit/runtime/asi";
import type { Messages } from "../../messages/index.js";
import { html } from "../internal.js";
import {
  ANGLE_MODES,
  type AngleMode,
  BASIC_KEYS,
  type CalculatorKey,
  type CalculatorState,
  calculation,
  INITIAL_STATE,
  KEYBOARD_KEYS,
  press,
  SCIENTIFIC_ONLY_KEYS,
  SCIENTIFIC_STATE,
  STANDARD_ONLY_KEYS,
  setAngle,
} from "./calculator-engine.js";
import type { OpenTool, ToolContext } from "./context.js";
import { viewFile } from "./file-viewer.js";
import type { BuiltInCalculator } from "./model.js";
import { materialName, toolName } from "./names.js";
import { createPanel } from "./panel.js";

/** What a key shows, and the message that names it for assistive technology; the digits name themselves. */
const KEY_FACES: ReadonlyMap<CalculatorKey, readonly [string, keyof Messages]> = new Map([
  ["decimal", [".", "calculatorDecimal"]],
  ["add", ["+", "calculatorAdd"]],
  ["subtract", ["\u2212", "calculatorSubtract"]],
  ["multiply", ["\u00d7", "calculatorMultiply"]],
  ["divide", ["\u00f7", "calculatorDivide"]],
  ["equals", ["=", "calculatorEquals"]],
  ["clear", ["C", "calculatorClear"]],
  ["square-root", ["\u221a", "calculatorSquareRoot"]],
  ["percent", ["%", "calculatorPercent"]],
  ["sign", ["\u00b1", "calculatorSign"]],
  ["memory-clear", ["MC", "calculatorMemoryClear"]],
  ["memory-recall", ["MR", "calculatorMemoryRecall"]],
  ["memory-add", ["M+", "calculatorMemoryAdd"]],
  ["memory-subtract", ["M\u2212", "calculatorMemorySubtract"]],
  ["inverse", ["Inv", "calculatorInverse"]],
  ["hyperbolic", ["Hyp", "calculatorHyperbolic"]],
  ["open", ["(", "calculatorOpen"]],
  ["close", [")", "calculatorClose"]],
  ["sin", ["sin", "calculatorSine"]],
  ["cos", ["cos", "calculatorCosine"]],
  ["tan", ["tan", "calculatorTangent"]],
  ["pi", ["\u03c0", "calculatorPi"]],
  ["euler", ["e", "calculatorEuler"]],
  ["square", ["x\u00b2", "calculatorSquare"]],
  ["cube", ["x\u00b3", "calculatorCube"]],
  ["power", ["x\u02b8", "calculatorPower"]],
  ["cube-root", ["\u221b", "calculatorCubeRoot"]],
  ["root", ["\u02b8\u221ax", "calculatorRoot"]],
  ["log", ["log", "calculatorLog"]],
  ["ln", ["ln", "calculatorLn"]],
  ["ten-power", ["10\u02e3", "calculatorTenPower"]],
  ["exp", ["e\u02e3", "calculatorExp"]],
  ["reciprocal", ["1/x", "calculatorReciprocal"]],
  ["factorial", ["x!", "calculatorFactorial"]],
  ["permutations", ["nPr", "calculatorPermutations"]],
  ["combinations", ["nCr", "calculatorCombinations"]],
]);

/** The keys that turn a mode on and off, which show whether it is on. */
const TOGGLES: ReadonlySet<CalculatorKey> = new Set<CalculatorKey>(["inverse", "hyperbolic"]);

/** The message that names each unit of angle. */
const ANGLE_NAMES: Readonly<Record<AngleMode, keyof Messages>> = {
  degree: "calculatorDegrees",
  radian: "calculatorRadians",
  gradian: "calculatorGradians",
};

/** The rows of keys of each calculator: the standard one has the keys of the basic one below its own, and so on. */
const KEYPAD: readonly (readonly CalculatorKey[])[] = [
  ["7", "8", "9", "divide"],
  ["4", "5", "6", "multiply"],
  ["1", "2", "3", "subtract"],
  ["0", "decimal", "equals", "add"],
];
const LAYOUTS = {
  basic: [["clear"], ...KEYPAD],
  standard: [
    ["memory-clear", "memory-recall", "memory-add", "memory-subtract"],
    ["clear", "sign", "percent", "square-root"],
    ...KEYPAD,
  ],
  scientific: [
    ["inverse", "hyperbolic", "open", "close", "clear"],
    ["sin", "cos", "tan", "pi", "euler"],
    ["square", "cube", "power", "square-root", "cube-root"],
    ["root", "log", "ln", "ten-power", "exp"],
    ["reciprocal", "factorial", "permutations", "combinations", "percent"],
    ["memory-clear", "memory-recall", "memory-add", "memory-subtract", "sign"],
    ...KEYPAD,
  ],
} as const satisfies Readonly<Record<BuiltInCalculator, readonly (readonly CalculatorKey[])[]>>;

/** The keys a type of calculator has. */
const KEYS_OF: Readonly<Record<BuiltInCalculator, ReadonlySet<CalculatorKey>>> = {
  basic: new Set<CalculatorKey>(BASIC_KEYS),
  standard: new Set<CalculatorKey>([...BASIC_KEYS, ...STANDARD_ONLY_KEYS]),
  scientific: new Set<CalculatorKey>([...BASIC_KEYS, ...STANDARD_ONLY_KEYS, ...SCIENTIFIC_ONLY_KEYS]),
};

/** The columns of the keypad: rows of 4 and of 5 keys share them, and a row of fewer keys spans them. */
const COLUMNS = 20;

/** Returns the list of the unit of angle of the scientific calculator. */
function angleList(messages: Messages, onAngle: (angle: AngleMode) => void): HTMLElement {
  const select = html(
    "select",
    {},
    ...ANGLE_MODES.map((unit) => html("option", { value: unit }, messages[ANGLE_NAMES[unit]])),
  );
  select.addEventListener("change", () => {
    const unit = ANGLE_MODES.find((each) => each === select.value);
    if (unit !== undefined) onAngle(unit);
  });
  return html("label", { class: "ak-field" }, messages.calculatorAngle, select);
}

/** Builds the keys of a calculator in their rows; the keys of a mode go into `toggles`, so that they show whether it is on. */
function createKeypad(
  type: BuiltInCalculator,
  messages: Messages,
  pressKey: (key: CalculatorKey) => void,
  toggles: Map<CalculatorKey, HTMLButtonElement>,
): HTMLElement {
  const keypad = html("div", { class: "ak-keys" });
  for (const row of LAYOUTS[type]) {
    for (const key of row) {
      const face = KEY_FACES.get(key);
      const button = html(
        "button",
        { type: "button", class: "ak-button", ...(face === undefined ? {} : { "aria-label": messages[face[1]] }) },
        face === undefined ? key : face[0],
      );
      button.style.gridColumn = `span ${COLUMNS / row.length}`;
      button.addEventListener("click", () => pressKey(key));
      if (TOGGLES.has(key)) toggles.set(key, button);
      keypad.append(button);
    }
  }
  return keypad;
}

/**
 * Opens a built-in calculator: the basic, the standard or the scientific one.
 *
 * @remarks
 * The candidate operates it with the buttons or by typing: digits, the decimal point, the four operations, `=` or Enter,
 * `%`, Escape or Delete to clear, and on the scientific calculator `^`, `(`, `)` and `!`. Typing works while the focus is
 * anywhere in the calculator, but Enter still presses the focused button. The file of the calculator that the item gives,
 * if any, is shown below the keys.
 *
 * @param context - What the tool needs from the mount.
 * @param type - The calculator to build.
 * @param description - What the author says the calculator offers, or `null`.
 * @param file - The file that the item gives for the calculator, or `null`.
 * @param close - Called when the candidate closes the panel.
 * @returns The open tool.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, calculators}
 */
export function openCalculator(
  context: ToolContext,
  type: BuiltInCalculator,
  description: string | null,
  file: CalculatorInfo | null,
  close: () => void,
): OpenTool {
  const { messages } = context;
  const panel = createPanel(context, toolName({ kind: "calculator", type }, messages), close);
  const keys = KEYS_OF[type];
  let state: CalculatorState = type === "scientific" ? SCIENTIFIC_STATE : INITIAL_STATE;

  const display = html("output", { class: "ak-display", tabindex: "0", "aria-label": messages.calculatorDisplay });
  const memory = html("span", { class: "ak-memory", role: "img", "aria-label": messages.calculatorMemory }, "M");
  const line = html("div", { class: "ak-calculation" });
  const toggles = new Map<CalculatorKey, HTMLButtonElement>();
  const render = (): void => {
    display.textContent = state.error ? messages.calculatorError : state.display;
    memory.hidden = state.memory === 0;
    line.textContent = calculation(state);
    toggles.get("inverse")?.setAttribute("aria-pressed", String(state.inverse));
    toggles.get("hyperbolic")?.setAttribute("aria-pressed", String(state.hyperbolic));
  };
  const pressKey = (key: CalculatorKey): void => {
    state = press(state, key);
    render();
  };

  const keypad = createKeypad(type, messages, pressKey, toggles);
  panel.body.append(
    html(
      "div",
      { class: type === "scientific" ? "ak-calculator ak-scientific" : "ak-calculator" },
      ...(description === null ? [] : [html("p", {}, description)]),
      ...(type === "scientific"
        ? [
            angleList(messages, (angle) => {
              state = setAngle(state, angle);
            }),
          ]
        : []),
      html("div", { class: "ak-screen" }, memory, html("div", { class: "ak-readout" }, line, display)),
      keypad,
    ),
    // The calculator is available at the location of its file with the viewer, which shows it without running it.
    ...(file === null
      ? []
      : [html("div", { role: "group", "aria-label": materialName(file) }, viewFile(context, file))]),
  );
  panel.element.addEventListener("keydown", (event) => {
    const key = KEYBOARD_KEYS.get(event.key);
    if (key === undefined || !keys.has(key) || event.ctrlKey || event.altKey || event.metaKey) return;
    // Enter presses the button that has the focus, as it does everywhere, and a list keeps its own keys.
    if (event.target instanceof HTMLSelectElement) return;
    if (event.target instanceof HTMLButtonElement && event.key === "Enter") return;
    event.preventDefault();
    pressKey(key);
  });
  render();

  return { focus: () => display.focus(), destroy: () => panel.remove() };
}
