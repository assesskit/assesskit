import { DataError } from "../errors.js";
import { type CodePointSet, complement, subtract, union } from "./code-point-set.js";
import { categorySet } from "./general-categories.js";
import { UNICODE_BLOCKS } from "./unicode-blocks.js";
import { NAME_CHARS, NAME_START_CHARS } from "./xml-names.js";

/** A parsed pattern. */
export type RegexNode =
  | { readonly kind: "set"; readonly set: CodePointSet }
  | { readonly kind: "sequence"; readonly items: readonly RegexNode[] }
  | { readonly kind: "choice"; readonly options: readonly RegexNode[] }
  | { readonly kind: "repeat"; readonly node: RegexNode; readonly min: number; readonly max: number | undefined };

const code = (character: string): number => character.codePointAt(0) ?? 0;
const single = (point: number): CodePointSet => [[point, point]];

/** `\s`: space, tab, line feed and carriage return (XML Schema 1.0 Part 2, F.1.1). */
const SPACES: CodePointSet = [
  [0x9, 0xa],
  [0xd, 0xd],
  [0x20, 0x20],
];

/** `.`: every character but line feed and carriage return. */
const WILDCARD: CodePointSet = complement([
  [0xa, 0xa],
  [0xd, 0xd],
]);

/**
 * The general categories that `\p{...}` names: the seven major classes and their subcategories (XML Schema 1.0 Part 2,
 * F.1.1). `Cs` is not among them.
 */
const CATEGORIES: ReadonlySet<string> = new Set(
  [
    "L Lu Ll Lt Lm Lo",
    "M Mn Mc Me",
    "N Nd Nl No",
    "P Pc Pd Ps Pe Pi Pf Po",
    "Z Zs Zl Zp",
    "S Sm Sc Sk So",
    "C Cc Cf Co Cn",
  ].flatMap((classes) => classes.split(" ")),
);

/** The characters that `\` escapes to themselves, and the three that it escapes to a control character. */
const SINGLE_ESCAPES: ReadonlyMap<string, number> = new Map([
  ...[..."\\|.?*+(){}-[]^"].map((character): [string, number] => [character, code(character)]),
  ["n", 0xa],
  ["r", 0xd],
  ["t", 0x9],
]);

/** `\p{P}`, `\p{Z}` and `\p{C}` form the complement of `\w`. */
const NON_WORD_CLASSES = ["P", "Z", "C"] as const;

function category(name: string): CodePointSet {
  return categorySet(name) ?? [];
}

const MULTI_ESCAPES: ReadonlyMap<string, () => CodePointSet> = new Map([
  ["s", () => SPACES],
  ["S", () => complement(SPACES)],
  ["i", () => NAME_START_CHARS],
  ["I", () => complement(NAME_START_CHARS)],
  ["c", () => NAME_CHARS],
  ["C", () => complement(NAME_CHARS)],
  ["d", () => category("Nd")],
  ["D", () => complement(category("Nd"))],
  ["w", () => complement(union(...NON_WORD_CLASSES.map(category)))],
  ["W", () => union(...NON_WORD_CLASSES.map(category))],
]);

/** The characters that cannot stand for themselves outside a character class. */
const META = new Set([..."\\.?*+{}()|[]"]);

/**
 * Reads a pattern of XML Schema 1.0's regular expressions (Part 2, Appendix F) into a tree: the dialect of
 * `qti-pattern-match` and `pattern-mask`. A pattern matches the whole text, `^` and `$` are ordinary characters, and
 * `-` stands for itself in a class only at its start or end.
 */
export class PatternParser {
  private readonly pattern: string;
  private readonly characters: readonly string[];
  private readonly maxDepth: number;
  private position = 0;

  /**
   * @param pattern - The pattern.
   * @param maxDepth - The most levels that groups and class subtractions may be nested.
   */
  constructor(pattern: string, maxDepth: number) {
    this.pattern = pattern;
    this.characters = Array.from(pattern);
    this.maxDepth = maxDepth;
  }

  /** Reads the whole pattern. */
  parse(): RegexNode {
    const node = this.regExp(0);
    if (this.position < this.characters.length) this.fail(`an unmatched ${this.peek()}`);
    return node;
  }

  private fail(problem: string): never {
    throw new DataError(
      `The pattern ${JSON.stringify(this.pattern)} is not an XML Schema regular expression: ${problem} at character ${this.position + 1}.`,
    );
  }

  private peek(offset = 0): string | undefined {
    return this.characters[this.position + offset];
  }

  private next(problem = "an unexpected end"): string {
    const character = this.peek();
    if (character === undefined) this.fail(problem);
    this.position++;
    return character;
  }

  /** Reads the character that closes a construct. */
  private close(character: string, problem: string): void {
    if (this.next(problem) !== character) {
      this.position--;
      this.fail(problem);
    }
  }

  private enter(depth: number): number {
    if (depth >= this.maxDepth) this.fail(`more than ${this.maxDepth} levels of nesting`);
    return depth + 1;
  }

  private regExp(depth: number): RegexNode {
    const options = [this.branch(depth)];
    while (this.peek() === "|") {
      this.position++;
      options.push(this.branch(depth));
    }
    return options.length === 1 ? (options[0] ?? { kind: "sequence", items: [] }) : { kind: "choice", options };
  }

  private branch(depth: number): RegexNode {
    const items: RegexNode[] = [];
    for (let next = this.peek(); next !== undefined && next !== "|" && next !== ")"; next = this.peek()) {
      items.push(this.piece(depth));
    }
    return items.length === 1 ? (items[0] ?? { kind: "sequence", items }) : { kind: "sequence", items };
  }

  private piece(depth: number): RegexNode {
    const node = this.atom(depth);
    const quantifier = this.peek();
    if (quantifier === "?") return this.repeat(node, 0, 1);
    if (quantifier === "*") return this.repeat(node, 0, undefined);
    if (quantifier === "+") return this.repeat(node, 1, undefined);
    if (quantifier !== "{") return node;
    this.position++;
    const min = this.count();
    let max: number | undefined = min;
    if (this.peek() === ",") {
      this.position++;
      max = this.peek() === "}" ? undefined : this.count();
    }
    this.close("}", "a quantifier that is not closed by }");
    if (max !== undefined && max < min) this.fail(`a quantifier whose maximum ${max} is below its minimum ${min}`);
    return { kind: "repeat", node, min, max };
  }

  private repeat(node: RegexNode, min: number, max: number | undefined): RegexNode {
    this.position++;
    return { kind: "repeat", node, min, max };
  }

  private count(): number {
    let digits = "";
    for (let next = this.peek(); next !== undefined && next >= "0" && next <= "9"; next = this.peek()) {
      digits += next;
      this.position++;
    }
    if (digits === "") this.fail("a quantifier without a number");
    return Number(digits);
  }

  private atom(depth: number): RegexNode {
    const character = this.next();
    if (character === "(") {
      const node = this.regExp(this.enter(depth));
      this.close(")", "a group that is not closed by )");
      return node;
    }
    if (character === "[") return { kind: "set", set: this.classExpression(depth) };
    if (character === "\\") return { kind: "set", set: this.escape(false) };
    if (character === ".") return { kind: "set", set: WILDCARD };
    if (META.has(character)) {
      this.position--;
      this.fail(`a ${character} that stands for nothing`);
    }
    return { kind: "set", set: single(code(character)) };
  }

  /** Reads an escape after its `\`: a set of characters, or within a range `[a-z]` one character. */
  private escape(inClass: boolean): CodePointSet {
    const character = this.next();
    const escaped = SINGLE_ESCAPES.get(character);
    if (escaped !== undefined) return single(escaped);
    const multiple = MULTI_ESCAPES.get(character);
    if (multiple !== undefined) return multiple();
    if (character === "p" || character === "P") {
      const set = this.property();
      return character === "p" ? set : complement(set);
    }
    this.position--;
    return this.fail(`the escape \\${character}, which XML Schema does not have${inClass ? " in a class" : ""}`);
  }

  /** Reads `{name}` of `\p` or `\P`: a general category, or `Is` and a block. */
  private property(): CodePointSet {
    this.close("{", "a \\p or \\P without {");
    let name = "";
    for (let next = this.next("a \\p or \\P whose { is not closed by }"); next !== "}"; ) {
      name += next;
      next = this.next("a \\p or \\P whose { is not closed by }");
    }
    if (CATEGORIES.has(name)) return category(name);
    const block = name.startsWith("Is") ? UNICODE_BLOCKS.get(name.slice(2)) : undefined;
    if (block === undefined) this.fail(`the property ${JSON.stringify(name)}, which is no category or block`);
    return block;
  }

  /** Reads a character class after its `[`, up to and with its `]`. */
  private classExpression(depth: number): CodePointSet {
    const negative = this.peek() === "^";
    if (negative) this.position++;
    const parts: CodePointSet[] = [];
    const group = (): CodePointSet => (negative ? complement(union(...parts)) : union(...parts));
    const unclosed = "a character class that is not closed by ]";
    for (let character = this.next(unclosed); character !== "]"; character = this.next(unclosed)) {
      if (character === "-" && this.peek() === "[" && parts.length > 0) {
        this.position++;
        const subtracted = this.classExpression(this.enter(depth));
        this.close("]", "a class subtraction that does not end the class");
        return subtract(group(), subtracted);
      }
      parts.push(this.classItem(character, parts.length === 0));
    }
    if (parts.length === 0) this.fail("an empty character class");
    return group();
  }

  /** Reads one character, range or escape of a character class. */
  private classItem(character: string, first: boolean): CodePointSet {
    if (character === "[") this.fail("a [ in a character class that is not escaped");
    // A - stands for itself first or last in a group, and the group can end before a subtraction.
    const last = this.peek() === "]" || (this.peek() === "-" && this.peek(1) === "[");
    if (character === "-" && !first && !last) this.fail("a - within a character class");
    const start = character === "\\" ? this.escape(true) : single(code(character));
    const [range] = start;
    const isOne = start.length === 1 && range !== undefined && range[0] === range[1];
    const rangeFollows = this.peek() === "-" && ![undefined, "]", "["].includes(this.peek(1));
    if (!isOne || !rangeFollows) return start;
    this.position++;
    const end = this.rangeEnd();
    if (end < range[0]) this.fail("a range whose end comes before its start");
    return [[range[0], end]];
  }

  /** Reads the end of a range after its `-`: a character or an escape of one. */
  private rangeEnd(): number {
    const character = this.next();
    if (character === "\\") {
      const escaped = SINGLE_ESCAPES.get(this.next());
      return escaped ?? this.fail("a range that ends in an escape of several characters");
    }
    if (character === "-" || character === "[") this.fail(`a range that ends in ${character}`);
    return code(character);
  }
}
