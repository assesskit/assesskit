import { AssesskitError } from "@assesskit/runtime/errors";
import { isRasterDataUrl } from "../content/internal.js";

/**
 * The rules an item stylesheet may keep.
 *
 * @remarks
 * Every other at-rule is dropped: `@import` would fetch a sheet that the player has not looked at, `@property` and
 * `@scope` can name resources or reach outside the root, and `@font-face` and `@page` have declarations that Firefox does
 * not let a script change, so that a URL in them could be neither rewritten nor removed. A font face declared in a shadow
 * root does not apply in every engine either: the host declares the fonts of its packages in the page.
 */
let kept: readonly (abstract new () => CSSRule)[] | undefined;

/** The types of rule that the player keeps, looked up when a stylesheet is cleaned: a server that imports the player has none of them. */
const keptRules = (): readonly (abstract new () => CSSRule)[] =>
  (kept ??= [
    CSSStyleRule,
    CSSMediaRule,
    CSSSupportsRule,
    CSSKeyframesRule,
    CSSKeyframeRule,
    CSSLayerBlockRule,
    CSSLayerStatementRule,
    CSSContainerRule,
  ]);

/** A selector that reaches the host of the root or the content slotted into it: an item cannot restyle the player's frame. */
const HOST_SELECTOR = /:host|::slotted/iu;

/** A `url()` as the browser serializes one: the quoted string, which the engine has parsed and so unescaped. */
const SERIALIZED_URL = /url\("((?:[^"\\]|\\.)*)"\)/giu;

/**
 * What a value may not still contain once its serialized `url()`s are checked: a backslash, which can hide a function
 * name in the values that the browser keeps as written (custom properties and `var()`), and the functions that load a
 * resource by another name.
 */
const HIDDEN_LOADERS = /\\|(?:url|image-set|image|cross-fade|src|element|paint)\(/iu;

/** What the stylesheet loader reads of a response. */
export interface StylesheetResponse {
  /** Whether the status is 200 to 299. */
  readonly ok: boolean;
  /** The HTTP status. */
  readonly status: number;
  /**
   * Returns the body as text.
   *
   * @returns The text.
   */
  text(): Promise<string>;
}

/** The part of the web standard `fetch` that the loader calls, so that a host passes `fetch`, or a replacement. */
export type StylesheetFetch = (
  url: string,
  request: { readonly credentials: "omit"; readonly referrerPolicy: "no-referrer"; readonly signal?: AbortSignal },
) => Promise<StylesheetResponse>;

/** The origins a stylesheet may load resources from, and what it is based at. */
export interface StylesheetPolicy {
  /** The absolute URL of the stylesheet, against which its relative `url()`s resolve. */
  readonly url: string;
  /** The origins besides that of the stylesheet itself. */
  readonly origins: ReadonlySet<string>;
}

/** Returns the absolute URL of a reference of the stylesheet, or `undefined` when the stylesheet may not load it. */
function resolveStyleUrl(reference: string, { url, origins }: StylesheetPolicy): string | undefined {
  try {
    const target = new URL(reference, url);
    if (target.protocol === "data:") return isRasterDataUrl(target.href) ? target.href : undefined;
    const isWeb = target.protocol === "http:" || target.protocol === "https:";
    return isWeb && (target.origin === new URL(url).origin || origins.has(target.origin)) ? target.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns the value of a declaration with each `url()` written as an absolute URL, or `undefined` when the value loads
 * what the policy does not allow.
 *
 * @remarks
 * The URLs are resolved here, against the URL of the stylesheet, because a constructed sheet resolves them against the
 * document in Chromium, whatever its `baseURL` says.
 */
function rewriteValue(value: string, policy: StylesheetPolicy): string | undefined {
  const resolved = [...value.matchAll(SERIALIZED_URL)].map(([, reference]) =>
    resolveStyleUrl((reference ?? "").replace(/\\(.)/gu, "$1"), policy),
  );
  if (resolved.includes(undefined)) return undefined;
  if (HIDDEN_LOADERS.test(value.replace(SERIALIZED_URL, ""))) return undefined;
  let index = 0;
  return value.replace(SERIALIZED_URL, () => `url("${(resolved[index++] ?? "").replace(/["\\]/gu, "\\$&")}")`);
}

function cleanDeclarations(style: CSSStyleDeclaration, policy: StylesheetPolicy): void {
  for (let index = style.length - 1; index >= 0; index--) {
    const name = style.item(index);
    const value = style.getPropertyValue(name);
    const rewritten = rewriteValue(value, policy);
    if (rewritten === undefined) style.removeProperty(name);
    else if (rewritten !== value) style.setProperty(name, rewritten, style.getPropertyPriority(name));
  }
  // A shorthand with `var()` keeps its tokens as written and lists no longhand with a value, so what hides in it is found
  // in the text of the block, and the block goes.
  if (HIDDEN_LOADERS.test(style.cssText.replace(SERIALIZED_URL, ""))) style.cssText = "";
}

/** The rules that hold rules, and can delete them. */
interface RuleParent {
  readonly cssRules: CSSRuleList;
  deleteRule(index: number): void;
}

function cleanRule(rule: CSSRule, policy: StylesheetPolicy): void {
  if ("style" in rule && rule.style instanceof CSSStyleDeclaration) cleanDeclarations(rule.style, policy);
  if (rule instanceof CSSKeyframesRule) {
    for (const frame of rule.cssRules) cleanRule(frame, policy);
  } else if (rule instanceof CSSGroupingRule) {
    cleanRules(rule, policy);
  }
}

function cleanRules(parent: RuleParent, policy: StylesheetPolicy): void {
  for (let index = parent.cssRules.length - 1; index >= 0; index--) {
    const rule = parent.cssRules.item(index);
    if (rule === null) continue;
    const kept =
      keptRules().some((type) => rule instanceof type) &&
      !(rule instanceof CSSStyleRule && HOST_SELECTOR.test(rule.selectorText));
    if (kept) cleanRule(rule, policy);
    else parent.deleteRule(index);
  }
}

/**
 * Builds the constructed stylesheet of an item stylesheet, and removes from it what a content root must not take from an
 * item.
 *
 * @remarks
 * - `@import`, which a constructed sheet ignores, and every at-rule besides the usual ones, go.
 * - Rules whose selector names `:host` or `::slotted` go, because they would restyle the root's host and so escape its
 *   containment.
 * - Declarations with a `url()` outside the sheet's own origin and the allowed ones go, and so do those with the other
 *   functions that load a resource (`image-set()`, `cross-fade()` and the like).
 *
 * The work is done on the parsed rules, which the browser has normalized, so CSS escapes cannot hide a function. Relative
 * `url()`s are written as absolute URLs resolved against the URL of the stylesheet.
 *
 * @param text - The CSS.
 * @param policy - See {@link StylesheetPolicy}.
 * @returns The sheet.
 */
export function sanitizeStylesheet(text: string, policy: StylesheetPolicy): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  cleanRules(sheet, policy);
  return sheet;
}

/**
 * Fetches an item stylesheet and sanitizes it.
 *
 * @remarks
 * The request carries no credentials and no referrer: the gate's URL holds the token.
 *
 * @param policy - See {@link StylesheetPolicy}.
 * @param fetcher - The fetch to load it with.
 * @returns The sheet.
 * @throws `AssesskitError` when the stylesheet cannot be fetched.
 */
export async function loadStylesheet(policy: StylesheetPolicy, fetcher: StylesheetFetch): Promise<CSSStyleSheet> {
  let response: StylesheetResponse;
  try {
    response = await fetcher(policy.url, { credentials: "omit", referrerPolicy: "no-referrer" });
  } catch (cause) {
    throw new AssesskitError(`The stylesheet ${policy.url} could not be fetched: ${String(cause)}`, { cause });
  }
  if (!response.ok)
    throw new AssesskitError(`The stylesheet ${policy.url} could not be fetched: HTTP ${response.status}.`);
  return sanitizeStylesheet(await response.text(), policy);
}
