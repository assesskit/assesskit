import { checkOptions, checkPositiveInteger, checkRecord, checkString } from "../checks.js";
import { DataError } from "../errors.js";
import { buildMatcher, type XsdPattern } from "./xsd-regex-matcher.js";
import { countStates } from "./xsd-regex-nfa.js";
import { PatternParser } from "./xsd-regex-parser.js";

/** The limits on compiling a pattern. */
export interface XsdRegexLimits {
  /**
   * The most states the automaton of a pattern may have once its counted repeats are expanded.
   *
   * @defaultValue `100000`
   */
  readonly maxStates: number;
  /**
   * The most levels that groups and character class subtractions may be nested. It bounds the recursion of the parser.
   *
   * @defaultValue `100`
   */
  readonly maxDepth: number;
}

/** The default limits: `maxStates` allows `a{100000}`, the largest repeat of one character. */
export const DEFAULT_XSD_REGEX_LIMITS: XsdRegexLimits = { maxStates: 100_000, maxDepth: 100 };

/** The options of {@link compileXsdRegex}. */
export interface CompileXsdRegexOptions {
  /**
   * Limits that replace those of {@link DEFAULT_XSD_REGEX_LIMITS}; a limit left out keeps its default.
   *
   * @defaultValue `{}`
   */
  readonly limits?: Partial<XsdRegexLimits>;
}

/**
 * Compiles a pattern of the regular expressions of XML Schema, the dialect of `qti-pattern-match` and `pattern-mask`.
 *
 * @remarks
 * A pattern matches the whole text, and `^` and `$` are ordinary characters. The language has `\i`, `\c`, `\d`, `\w`, the
 * general categories of Unicode {@link UNICODE_VERSION}, the blocks of Unicode 3.1 and class subtraction. The pattern
 * becomes a Thompson automaton over code points, which {@link XsdPattern.matches} runs in time linear in the text, so
 * that no pattern can make a text expensive.
 *
 * @param pattern - The pattern.
 * @param options - Limits on the size of the automaton and the nesting of the pattern.
 * @returns The compiled pattern.
 * @throws `DataError` when `pattern` or an option is not valid, when the pattern is not in the dialect, or when it
 * needs more than `maxStates` states or is nested deeper than `maxDepth`.
 * @see {@link https://www.w3.org/TR/xmlschema-2/#regexs | XML Schema Part 2, regular expressions}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, patternMatch and patternMask}
 */
export function compileXsdRegex(pattern: string, options: CompileXsdRegexOptions = {}): XsdPattern {
  checkString(pattern, "The pattern");
  checkOptions(options);
  const { limits = {} } = options;
  checkRecord(limits, "The option limits must be an object");
  const { maxStates = DEFAULT_XSD_REGEX_LIMITS.maxStates, maxDepth = DEFAULT_XSD_REGEX_LIMITS.maxDepth } = limits;
  checkPositiveInteger(maxStates, "The limit maxStates");
  checkPositiveInteger(maxDepth, "The limit maxDepth");
  const tree = new PatternParser(pattern, maxDepth).parse();
  if (countStates(tree, maxStates) > maxStates) {
    throw new DataError(
      `The pattern ${JSON.stringify(pattern)} needs more than ${maxStates} states once its repeats are expanded.`,
    );
  }
  return buildMatcher(tree);
}
