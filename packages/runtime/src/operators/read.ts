import { DataError, SecurityError } from "../errors.js";
import { type DecimalSeparator, type Token, tokenize } from "./tokens.js";
import type { Entry, Factor, FunctionName, Node, Relation, Statement, Term } from "./tree.js";

/** The limits of a line that the reader takes. */
export interface ReadLimits {
  /** The most characters, as UTF-16 code units. */
  readonly maxInputLength: number;
  /** The most levels of groups, fractions, roots, exponents, function arguments and bars, the top level being 1. */
  readonly maxExpressionDepth: number;
}

/** The Greek letters that are variables: every letter's command but `\pi`, a constant. */
const GREEK = new Set([
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "varepsilon",
  "zeta",
  "eta",
  "theta",
  "vartheta",
  "iota",
  "kappa",
  "varkappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "varpi",
  "rho",
  "varrho",
  "sigma",
  "varsigma",
  "tau",
  "upsilon",
  "phi",
  "varphi",
  "chi",
  "psi",
  "omega",
  "Gamma",
  "Delta",
  "Theta",
  "Lambda",
  "Xi",
  "Pi",
  "Sigma",
  "Upsilon",
  "Phi",
  "Psi",
  "Omega",
]);

/** The functions written as commands, `\sin`, by the function each reads as; `\lg` and `\log` are base 10. */
const FUNCTION_COMMANDS: ReadonlyMap<string, FunctionName> = new Map([
  ["sin", "sin"],
  ["cos", "cos"],
  ["tan", "tan"],
  ["sec", "sec"],
  ["csc", "csc"],
  ["cot", "cot"],
  ["arcsin", "arcsin"],
  ["arccos", "arccos"],
  ["arctan", "arctan"],
  ["sinh", "sinh"],
  ["cosh", "cosh"],
  ["tanh", "tanh"],
  ["exp", "exp"],
  ["ln", "ln"],
  ["log", "log"],
  ["lg", "log"],
]);

/** The function names that `\operatorname{}`, `\mathrm{}` and plain text before a bracket take. */
const FUNCTION_WORDS: ReadonlyMap<string, FunctionName> = new Map([...FUNCTION_COMMANDS, ["lb", "lb"], ["abs", "abs"]]);
/** The plain-text names, which also hold `sqrt`, longest first, so that `sinh(` is not `sin` and `h(`. */
const PLAIN_WORDS: ReadonlyMap<string, FunctionName> = new Map([...FUNCTION_WORDS, ["sqrt", "sqrt"]]);
const LONGEST_WORD = 6;

/** The functions whose power `-1` is their inverse. */
const INVERSES: ReadonlyMap<FunctionName, FunctionName> = new Map([
  ["sin", "arcsin"],
  ["cos", "arccos"],
  ["tan", "arctan"],
]);

const FRACTIONS = new Set(["frac", "dfrac", "tfrac", "cfrac"]);
/** What may follow an atom: a superscript, which may be the degree sign, a percent sign or a degree sign. */
const POSTFIXES = new Set(["^", "\\%", "\\degree"]);
const PRODUCTS = new Set(["\\cdot", "\\times", "*"]);
const QUOTIENTS = new Set(["/", "\\div"]);
const RELATIONS: ReadonlyMap<string, Relation> = new Map([
  ["=", "="],
  ["<", "<"],
  [">", ">"],
  ["\\lt", "<"],
  ["\\gt", ">"],
  ["\\le", "<="],
  ["\\leq", "<="],
  ["\\leqslant", "<="],
  ["\\ge", ">="],
  ["\\geq", ">="],
  ["\\geqslant", ">="],
  ["\\ne", "!="],
  ["\\neq", "!="],
]);
/** The delimiters after `\left`, by the delimiters after `\right` that close them: parentheses and brackets. */
const LEFT_RIGHT: ReadonlyMap<string, readonly string[]> = new Map([
  ["(", [")"]],
  ["[", ["]", "\\rbrack"]],
  ["\\lbrack", ["]", "\\rbrack"]],
]);
/** The brackets of a group, by their opening token, with the tokens that may close them: those and braces. */
const BRACKETS: ReadonlyMap<string, readonly string[]> = new Map([...LEFT_RIGHT, ["{", ["}"]]]);
const LEFT_BARS = new Set(["|", "\\lvert", "\\vert"]);
const RIGHT_BARS = ["|", "\\rvert", "\\vert"];
const SET_OPENERS = new Set(["\\{", "\\lbrace"]);
const SET_CLOSERS = ["\\}", "\\rbrace"];
const MAX_SUBSCRIPT = 8;

/** A variable's name as the reader gives it: a letter or a Greek letter's name, and an optional subscript after `_`. */
const VARIABLE_NAME = /^([A-Za-z]+)(?:_[A-Za-z0-9]{1,8})?$/;

/**
 * Whether a text is the name the reader gives a variable, as a key's sample ranges and a follow-through name them: `x`,
 * `x_1`, `alpha`, `alpha_12`; a Latin letter but `e`, or a Greek letter's name but `pi`.
 */
export function isVariableName(name: string): boolean {
  const base = VARIABLE_NAME.exec(name)?.[1];
  if (base === undefined) return false;
  return base.length === 1 ? base !== "e" : GREEK.has(base);
}

/** The key of a token: a command with its backslash, or the text of any other token. */
function keyOf(token: Token | undefined): string {
  if (token === undefined) return "";
  return token.type === "command" ? `\\${token.text}` : token.text;
}

/** Whether a node is the number -1, as `^{-1}` writes it. */
function isMinusOne(node: Node): boolean {
  return node.kind === "negate" && node.node.kind === "number" && node.node.value === 1;
}

/** A recursive-descent reader of one line of the subset, whose depth the limits bound, so its time is linear in the line. */
class Reader {
  private readonly tokens: Token[];
  private readonly separator: DecimalSeparator;
  private readonly limits: ReadLimits;
  private position = 0;
  private depth = 1;
  /** The bars `|` open in the current bracket, so that a `|` in operand position closes the innermost. */
  private bars = 0;
  /** The `±` signs of the current entry. */
  private signs = 0;

  constructor(text: string, separator: DecimalSeparator, limits: ReadLimits) {
    this.tokens = tokenize(text, separator);
    this.separator = separator;
    this.limits = limits;
  }

  statement(): Statement {
    if (this.tokens.length === 0) this.fail("The expression is blank.");
    const braced = this.atSetOpener();
    const entries = braced ? this.nested(() => this.setEntries()) : this.entries();
    if (this.position < this.tokens.length) this.fail(`${keyOf(this.peek())} is not expected here.`);
    const [first] = entries;
    return entries.length === 1 && first !== undefined && !braced
      ? { kind: "entry", entry: first }
      : { kind: "list", entries };
  }

  private entries(): Entry[] {
    const entries = [this.entry()];
    while (this.atListSeparator()) {
      this.position += 1;
      entries.push(this.entry());
    }
    return entries;
  }

  private setEntries(): Entry[] {
    const left = this.peek()?.text === "left";
    this.position += left ? 2 : 1;
    const entries = this.entries();
    this.expectClosing(left, SET_CLOSERS);
    return entries;
  }

  private atSetOpener(): boolean {
    const key = keyOf(this.peek());
    return SET_OPENERS.has(key) || (key === "\\left" && SET_OPENERS.has(keyOf(this.peek(1))));
  }

  private atListSeparator(): boolean {
    const key = keyOf(this.peek());
    return key === (this.separator === "." ? "," : ";") || key === "\\lor";
  }

  private entry(): Entry {
    this.signs = 0;
    const left = this.sum();
    const relation = RELATIONS.get(keyOf(this.peek()));
    if (relation === undefined) return { kind: "expression", node: left, signs: this.signs };
    this.position += 1;
    const right = this.sum();
    if (RELATIONS.has(keyOf(this.peek()))) this.fail("A line holds one relation at most.");
    return { kind: "relation", relation, left, right, signs: this.signs };
  }

  private sum(): Node {
    const terms: Term[] = [this.signedTerm(this.leadingSign())];
    for (let sign = this.nextSign(); sign !== undefined; sign = this.nextSign()) terms.push(this.signedTerm(sign));
    const [only] = terms;
    return terms.length === 1 && only !== undefined && only.sign === 1 ? only.node : { kind: "sum", terms };
  }

  /** The sign of a sum's first term: a leading `\pm`, or else 1, since a leading `-` is its factor's own. */
  private leadingSign(): Term["sign"] {
    if (keyOf(this.peek()) !== "\\pm") return 1;
    this.position += 1;
    return "plus-minus";
  }

  /** The sign between two terms, `+`, `-` or `\pm`, or `undefined` when the sum ends. */
  private nextSign(): Term["sign"] | undefined {
    const key = keyOf(this.peek());
    const sign = key === "+" ? 1 : key === "-" ? -1 : key === "\\pm" ? "plus-minus" : undefined;
    if (sign !== undefined) this.position += 1;
    return sign;
  }

  private signedTerm(sign: Term["sign"]): Term {
    const index = sign === "plus-minus" ? this.signs++ : 0;
    return { sign, index, node: this.term() };
  }

  private term(): Node {
    const factors: Factor[] = [{ inverse: false, node: this.signedFactor() }];
    for (;;) {
      const key = keyOf(this.peek());
      if (PRODUCTS.has(key) || QUOTIENTS.has(key)) {
        this.position += 1;
        factors.push({ inverse: QUOTIENTS.has(key), node: this.signedFactor() });
      } else if (this.startsFactor()) {
        this.refuseNumberBeside(factors.at(-1)?.node);
        factors.push({ inverse: false, node: this.postfixed() });
      } else {
        break;
      }
    }
    const [only] = factors;
    return factors.length === 1 && only !== undefined ? only.node : { kind: "product", factors };
  }

  /** Refuses a number written beside a number, which would read as one number: `2 3` shows as 23. */
  private refuseNumberBeside(previous: Node | undefined): void {
    const bare = previous?.kind === "negate" ? previous.node : previous;
    if (bare?.kind === "number" && this.peek()?.type === "number")
      this.fail("Two numbers stand side by side; write the operator between them.");
  }

  /** A factor with the unary signs before it, counted, so that a run of signs costs no depth. */
  private signedFactor(): Node {
    let negative = false;
    for (let key = keyOf(this.peek()); key === "-" || key === "+"; key = keyOf(this.peek())) {
      negative = negative !== (key === "-");
      this.position += 1;
    }
    const node = this.postfixed();
    return negative ? { kind: "negate", node } : node;
  }

  /** An atom with its exponent, then its degrees and percents. */
  private postfixed(): Node {
    const atom = this.atom();
    let { node, powered } = atom;
    let degrees = 0;
    let percents = 0;
    for (let key = keyOf(this.peek()); POSTFIXES.has(key); key = keyOf(this.peek())) {
      this.position += 1;
      if (key === "\\%") percents += 1;
      else if (key === "\\degree") degrees += 1;
      else {
        if (powered) this.fail("A base takes one superscript at most.");
        powered = true;
        if (this.takeDegreeSign()) degrees += 1;
        else node = { kind: "power", base: node, exponent: this.nested(() => this.argument()) };
      }
    }
    return degrees === 0 && percents === 0 ? node : { kind: "scale", node, degrees, percents };
  }

  /** Takes `\circ` or `{\circ}` after a `^`, which is the degree sign. */
  private takeDegreeSign(): boolean {
    if (keyOf(this.peek()) === "\\circ") {
      this.position += 1;
      return true;
    }
    if (keyOf(this.peek()) === "{" && keyOf(this.peek(1)) === "\\circ" && keyOf(this.peek(2)) === "}") {
      this.position += 3;
      return true;
    }
    return false;
  }

  /** An atom; `powered` when a function took its power before its argument, as `\sin^2x`. */
  private atom(): { node: Node; powered: boolean } {
    const token = this.peek();
    if (token === undefined) this.fail("The expression ends where a value is expected.");
    if (token.type === "letter") return this.letterAtom(token);
    if (token.type === "command") return this.commandAtom(token);
    this.position += 1;
    if (token.type === "number") return { node: { kind: "number", value: Number(token.text) }, powered: false };
    const close = BRACKETS.get(token.text);
    if (close !== undefined) return { node: this.groupContent(close, false), powered: false };
    if (token.text === "|") return { node: this.bar(["|"], false), powered: false };
    return this.fail(`${token.text} is not expected here.`);
  }

  private letterAtom(token: Token): { node: Node; powered: boolean } {
    const plain = this.plainFunctionAt(this.position);
    if (plain !== undefined) {
      this.position += plain.length;
      return this.callOf(plain.name, true);
    }
    this.position += 1;
    if (token.text === "e") {
      if (keyOf(this.peek()) === "_") this.fail("The constant e takes no subscript.");
      return { node: { kind: "constant", name: "e" }, powered: false };
    }
    return { node: this.variable(token.text), powered: false };
  }

  private commandAtom(token: Token): { node: Node; powered: boolean } {
    const name = token.text;
    const call = FUNCTION_COMMANDS.get(name);
    this.position += 1;
    if (call !== undefined) return this.callOf(call, false, name === "log");
    if (GREEK.has(name)) return { node: this.variable(name), powered: false };
    if (name === "pi" || name === "exponentialE") {
      return { node: { kind: "constant", name: name === "pi" ? "pi" : "e" }, powered: false };
    }
    if (FRACTIONS.has(name)) return { node: this.fraction(), powered: false };
    if (name === "sqrt") return { node: this.root(), powered: false };
    if (name === "operatorname" || name === "mathrm") return this.named(name);
    if (name === "lvert") return { node: this.bar(["\\rvert"], false), powered: false };
    if (name === "lbrack") return { node: this.groupContent(["]", "\\rbrack"], false), powered: false };
    if (name === "left") return { node: this.leftGroup(), powered: false };
    return this.fail(`\\${name} is not part of the expression subset.`);
  }

  /** A word under `\operatorname{}` or `\mathrm{}`: a function's name, or `e` under `\mathrm`. */
  private named(command: string): { node: Node; powered: boolean } {
    this.expect("{");
    let word = "";
    while (this.peek()?.type === "letter" && word.length <= LONGEST_WORD) word += this.next().text;
    this.expect("}");
    if (word === "e" && command === "mathrm") return { node: { kind: "constant", name: "e" }, powered: false };
    const name = FUNCTION_WORDS.get(word);
    if (name === undefined) return this.fail(`\\${command}{${word}} is not part of the expression subset.`);
    return this.callOf(name, false, word === "log");
  }

  /**
   * A function word in plain text that starts at a token and stands before a bracket, such as `sin(x)` or `sqrt(x)`: its
   * letters adjoin, and the longest name wins.
   */
  private plainFunctionAt(start: number): { name: FunctionName; length: number } | undefined {
    let word = "";
    for (let index = start; index < this.tokens.length && word.length < LONGEST_WORD; index += 1) {
      const token = this.tokens[index];
      const before = this.tokens[index - 1];
      if (token?.type !== "letter" || (index > start && before?.end !== token.start)) break;
      word += token.text;
    }
    for (let length = word.length; length >= 2; length -= 1) {
      const name = PLAIN_WORDS.get(word.slice(0, length));
      if (name !== undefined && this.atBracket(start + length)) return { name, length };
    }
    return undefined;
  }

  /** Whether a bracket that a function's argument may open stands at an index. */
  private atBracket(index: number): boolean {
    const key = keyOf(this.tokens[index]);
    if (key === "\\left") return LEFT_RIGHT.has(keyOf(this.tokens[index + 1]));
    return BRACKETS.has(key);
  }

  /**
   * A function after its name: a power and, for `\log`, a base, in either order; then its argument, in brackets, or else
   * (not for plain text) the run of numbers, variables, constants, fractions and roots that follows.
   */
  private callOf(name: FunctionName, plain: boolean, takesBase = false): { node: Node; powered: boolean } {
    let exponent: Node | undefined;
    let base: Node | undefined;
    for (let side = 0; side < 2; side += 1) {
      const key = keyOf(this.peek());
      if (key === "^" && exponent === undefined) {
        this.position += 1;
        exponent = this.nested(() => this.argument());
      } else if (key === "_" && takesBase && base === undefined) {
        this.position += 1;
        base = this.nested(() => this.argument());
      }
    }
    if (keyOf(this.peek()) === "_") this.fail("Only \\log takes a subscript, its base.");
    const argument = this.atBracket(this.position) ? this.bracketArgument() : this.runArgument(plain);
    let node: Node = base === undefined ? { kind: "call", name, argument } : { kind: "logarithm", base, argument };
    if (exponent !== undefined) {
      const inverse = INVERSES.get(name);
      node =
        inverse !== undefined && isMinusOne(exponent)
          ? { kind: "call", name: inverse, argument }
          : { kind: "power", base: node, exponent };
    }
    return { node, powered: exponent !== undefined };
  }

  private bracketArgument(): Node {
    const token = this.next();
    if (token.type === "command" && token.text === "left") return this.leftGroup();
    const close = BRACKETS.get(keyOf(token)) ?? [];
    return this.groupContent(close, false);
  }

  /** The argument of a function without brackets: `\sin 2x` is sin(2x), and `\sin x\cos x` a product. */
  private runArgument(plain: boolean): Node {
    if (plain) this.fail("A function written in plain text takes its argument in brackets.");
    return this.nested(() => {
      const factors: Factor[] = [];
      while (this.startsRunFactor()) {
        this.refuseNumberBeside(factors.at(-1)?.node);
        factors.push({ inverse: false, node: this.postfixed() });
      }
      const [only] = factors;
      if (only === undefined) return this.fail("A function needs an argument.");
      return factors.length === 1 ? only.node : { kind: "product", factors };
    });
  }

  private startsRunFactor(): boolean {
    const token = this.peek();
    if (token === undefined) return false;
    if (token.type === "number") return true;
    if (token.type === "letter") return this.plainFunctionAt(this.position) === undefined;
    if (token.type === "symbol") return token.text === "|" && this.bars === 0;
    if (token.text === "left") return LEFT_BARS.has(keyOf(this.peek(1)));
    return (
      GREEK.has(token.text) || FRACTIONS.has(token.text) || ["pi", "exponentialE", "sqrt", "lvert"].includes(token.text)
    );
  }

  /** Whether the next token starts a factor that stands beside the one before it, a product. */
  private startsFactor(): boolean {
    const token = this.peek();
    if (token === undefined) return false;
    if (token.type === "number" || token.type === "letter") return true;
    if (token.type === "symbol") return BRACKETS.has(token.text) || (token.text === "|" && this.bars === 0);
    const name = token.text;
    if (name === "left") return LEFT_RIGHT.has(keyOf(this.peek(1))) || LEFT_BARS.has(keyOf(this.peek(1)));
    return (
      FUNCTION_COMMANDS.has(name) ||
      GREEK.has(name) ||
      FRACTIONS.has(name) ||
      ["pi", "exponentialE", "sqrt", "operatorname", "mathrm", "lvert", "lbrack"].includes(name)
    );
  }

  /** A variable, with its subscript: `x_1`, `x_{12}` and `\alpha_1` are variables of their own. */
  private variable(letter: string): Node {
    if (keyOf(this.peek()) !== "_") return { kind: "variable", name: letter };
    this.position += 1;
    return { kind: "variable", name: `${letter}_${this.subscript()}` };
  }

  /** The letters and digits of a subscript: a group of at most eight, or one character. */
  private subscript(): string {
    const token = this.next();
    if (token.type === "letter") return token.text;
    if (token.type === "number") return this.firstDigit(token);
    if (token.text !== "{" || token.type !== "symbol") return this.fail("A subscript is letters or digits.");
    let name = "";
    for (let part = this.next(); part.text !== "}" || part.type !== "symbol"; part = this.next()) {
      if (part.type !== "letter" && !(part.type === "number" && /^[0-9]+$/.test(part.text)))
        this.fail("A subscript is letters or digits.");
      name += part.text;
    }
    if (name === "" || name.length > MAX_SUBSCRIPT)
      this.fail(`A subscript holds 1 to ${MAX_SUBSCRIPT} letters or digits.`);
    return name;
  }

  /** The argument of a superscript, a fraction or a root: a group, or one character or command without arguments. */
  private argument(): Node {
    const token = this.next();
    // The caller has gone one level deeper for the argument, so its braces add none.
    if (token.type === "symbol" && token.text === "{") return this.groupContent(["}"], false, false);
    if (token.type === "number") return { kind: "number", value: Number(this.firstDigit(token)) };
    if (token.type === "letter")
      return token.text === "e" ? { kind: "constant", name: "e" } : { kind: "variable", name: token.text };
    if (token.type === "command" && GREEK.has(token.text)) return { kind: "variable", name: token.text };
    if (token.type === "command" && (token.text === "pi" || token.text === "exponentialE"))
      return { kind: "constant", name: token.text === "pi" ? "pi" : "e" };
    return this.fail(`${keyOf(token)} cannot stand alone as an argument; put it in braces.`);
  }

  /** Takes the first digit of a number as one character, as TeX does, and leaves the rest as a number. */
  private firstDigit(token: Token): string {
    const digit = token.text.charAt(0);
    if (!/[0-9]/.test(digit)) this.fail("A decimal mark cannot start an argument; put the number in braces.");
    const rest = token.text.slice(1);
    if (rest !== "") {
      this.position -= 1;
      this.tokens[this.position] = { type: "number", text: rest, start: token.start + 1, end: token.end };
    }
    return digit;
  }

  private fraction(): Node {
    const numerator = this.nested(() => this.argument());
    const denominator = this.nested(() => this.argument());
    return {
      kind: "product",
      factors: [
        { inverse: false, node: numerator },
        { inverse: true, node: denominator },
      ],
    };
  }

  /** `\sqrt{x}`, or `\sqrt[n]{x}`, the principal root x^(1/n), as SymPy's `root`. */
  private root(): Node {
    const key = keyOf(this.peek());
    if (key !== "[" && key !== "\\lbrack")
      return { kind: "call", name: "sqrt", argument: this.nested(() => this.argument()) };
    this.position += 1;
    const index = this.groupContent(["]", "\\rbrack"], false);
    const radicand = this.nested(() => this.argument());
    const reciprocal: Node = {
      kind: "product",
      factors: [
        { inverse: false, node: { kind: "number", value: 1 } },
        { inverse: true, node: index },
      ],
    };
    return { kind: "power", base: radicand, exponent: reciprocal };
  }

  /** A group or a bar opened by `\left`. */
  private leftGroup(): Node {
    const key = keyOf(this.next());
    const close = LEFT_RIGHT.get(key);
    if (close !== undefined) return this.groupContent(close, true);
    if (LEFT_BARS.has(key)) return this.bar(RIGHT_BARS, true);
    return this.fail(`\\left${key} is not part of the expression subset.`);
  }

  /**
   * The content of a group up to one of its closing tokens, one level deeper. A group opened by `\left` closes with `\right`;
   * a group outside the current bars starts with none open.
   */
  private groupContent(close: readonly string[], afterLeft: boolean, deeper = true): Node {
    const outer = this.bars;
    this.bars = 0;
    const node = deeper ? this.nested(() => this.sum()) : this.sum();
    this.bars = outer;
    this.expectClosing(afterLeft, close);
    return node;
  }

  /** The absolute value of what stands between two bars. */
  private bar(close: readonly string[], afterLeft: boolean): Node {
    this.bars += 1;
    const argument = this.nested(() => this.sum());
    this.bars -= 1;
    this.expectClosing(afterLeft, close);
    return { kind: "call", name: "abs", argument };
  }

  private expectClosing(afterLeft: boolean, close: readonly string[]): void {
    if (afterLeft && keyOf(this.next()) !== "\\right") this.fail("A \\left closes with \\right.");
    const key = keyOf(this.next());
    if (!close.includes(key)) this.fail(`The group closes with ${close.join(" or ")}, found ${key || "the end"}.`);
  }

  private expect(text: string): void {
    const key = keyOf(this.next());
    if (key !== text) this.fail(`Expected ${text}, found ${key || "the end"}.`);
  }

  /** Reads one level deeper, within `maxExpressionDepth`. */
  private nested<T>(read: () => T): T {
    this.depth += 1;
    const { maxExpressionDepth } = this.limits;
    if (this.depth > maxExpressionDepth) {
      throw new SecurityError(
        `The expression nests deeper than its limit maxExpressionDepth of ${maxExpressionDepth}.`,
        "maxExpressionDepth",
        maxExpressionDepth,
      );
    }
    try {
      return read();
    } finally {
      this.depth -= 1;
    }
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.position + offset];
  }

  private next(): Token {
    const token = this.tokens[this.position];
    if (token === undefined) return this.fail("The expression ends too soon.");
    this.position += 1;
    return token;
  }

  private fail(message: string): never {
    const at = this.peek()?.start;
    throw new DataError(at === undefined ? message : `${message} (at ${at})`);
  }
}

/**
 * Reads one line of the expression subset.
 *
 * @throws `SecurityError` past `maxInputLength` or `maxExpressionDepth`; `DataError` for a line the subset does not read.
 */
export function readStatement(text: string, separator: DecimalSeparator, limits: ReadLimits): Statement {
  if (text.length > limits.maxInputLength) {
    throw new SecurityError(
      `The expression has ${text.length} characters, over its limit maxInputLength of ${limits.maxInputLength}.`,
      "maxInputLength",
      limits.maxInputLength,
    );
  }
  return new Reader(text, separator, limits).statement();
}
