import { checkString, describe } from "../../checks.js";
import { DataError, TempuhError } from "../../errors.js";

/** The namespace of MathML (MathML 3 §2.1.1). */
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

/**
 * The elements of elementary math (MathML 3 §3.6), which MathJax 4 does not implement: it replaces an expression that
 * has one by a "Math input error" and drops the content.
 */
const ELEMENTARY_MATH = "mstack, mlongdiv, msgroup, msrow, mscarries, mscarry, msline";

/** The place of the fonts relative to the component: npm lays `@mathjax/mathjax-newcm-font` beside `mathjax`. */
const FONTS_PATH = "../@mathjax";

/**
 * The priority of the render action that leaves out expressions with elementary math: after `find` (10) and before
 * `compile` (20) (MathJax `MathItem.STATE`).
 */
const SKIP_PRIORITY = 15;

/** The parts of a MathJax math item that the render action reads: the node it was found in, none for a converted one. */
interface MathJaxItem {
  readonly start: { readonly node: unknown };
}

/** The parts of a MathJax math document that the render action uses. */
interface MathJaxDocument {
  readonly math: Iterable<MathJaxItem> & { remove(item: MathJaxItem): void };
}

/** The parts of the `MathJax` global that this module uses once MathJax is ready. */
interface MathJaxApi {
  typesetPromise(containers: readonly Element[]): Promise<void>;
  chtmlStylesheet(): HTMLStyleElement;
}

/** The startup of MathJax: `defaultReady` makes the API, and `promise` resolves when MathJax can typeset. */
interface MathJaxStartup {
  defaultReady(): void;
  readonly promise: Promise<unknown>;
}

/** The styles of MathJax's output that each shadow root has adopted, one sheet per root. */
const SHEETS = new WeakMap<ShadowRoot, CSSStyleSheet>();

/** The one MathJax of the page: its URL, and the promise of the loaded API. MathJax is a global, so a page has one. */
let loading: { readonly url: string; readonly api: Promise<MathJaxApi> } | undefined;

/** Returns whether an expression has an element that MathJax lacks. */
function hasElementaryMath(math: Element): boolean {
  return math.querySelector(ELEMENTARY_MATH) !== null;
}

/** The render action that takes the expressions with elementary math out of the ones MathJax typesets. */
function leaveOutElementaryMath(document: MathJaxDocument): void {
  for (const item of [...document.math]) {
    const { node } = item.start;
    if (node instanceof Element && hasElementaryMath(node)) document.math.remove(item);
  }
}

/**
 * The configuration that MathJax reads when it loads: no typesetting of the page, the fonts from the host and not from a
 * CDN, the render action that leaves elementary math to the browser, and a `ready` that tells the loader MathJax is up.
 */
function configuration(url: string, ready: () => void): object {
  return {
    startup: { typeset: false, ready },
    loader: { paths: { fonts: new URL(FONTS_PATH, url).href } },
    options: { renderActions: { leaveOutElementaryMath: [SKIP_PRIORITY, leaveOutElementaryMath, "", false] } },
  };
}

const NOT_MATHJAX = "The script that was loaded is not MathJax 4 with the CHTML output (mml-chtml.js).";

function mathJaxGlobal(): object {
  const global: unknown = Reflect.get(window, "MathJax");
  if (typeof global !== "object" || global === null) throw new TempuhError(NOT_MATHJAX);
  return global;
}

/** MathJax's startup is a class with static members, so it is a function; `promise` exists once `defaultReady` has run. */
function isStartup(value: unknown): value is MathJaxStartup {
  return typeof value === "function" && typeof Reflect.get(value, "defaultReady") === "function";
}

function isApi(value: object): value is MathJaxApi {
  return (
    typeof Reflect.get(value, "typesetPromise") === "function" &&
    typeof Reflect.get(value, "chtmlStylesheet") === "function"
  );
}

/** Returns the startup of the loaded script, which has the shape of MathJax 4's. */
function readStartup(): MathJaxStartup {
  const startup: unknown = Reflect.get(mathJaxGlobal(), "startup");
  if (!isStartup(startup)) throw new TempuhError(NOT_MATHJAX);
  return startup;
}

/** Returns the API that `defaultReady` made. */
function readApi(): MathJaxApi {
  const api = mathJaxGlobal();
  if (!isApi(api)) throw new TempuhError(NOT_MATHJAX);
  return api;
}

function loadScript(url: string): Promise<MathJaxApi> {
  return new Promise<MathJaxApi>((resolve, reject) => {
    const ready = (): void => {
      try {
        const startup = readStartup();
        startup.defaultReady();
        resolve(startup.promise.then(readApi));
      } catch (error) {
        reject(error);
      }
    };
    Reflect.set(window, "MathJax", configuration(url, ready));
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      // MathJax 4 sets its version as it runs; a script that is not MathJax never calls `ready`.
      const version: unknown = Reflect.get(mathJaxGlobal(), "version");
      if (typeof version !== "string" || !version.startsWith("4.")) reject(new TempuhError(NOT_MATHJAX));
    };
    script.onerror = () => reject(new TempuhError(`MathJax could not be loaded from ${url}.`));
    document.head.append(script);
  });
}

/** Adopts the styles of MathJax's output into a shadow root, where the styles in the document's head do not reach. */
function adoptStyles(api: MathJaxApi, root: ShadowRoot): void {
  let sheet = SHEETS.get(root);
  if (sheet === undefined) {
    sheet = new CSSStyleSheet();
    SHEETS.set(root, sheet);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
  // MathJax adds the rules for the characters that it has used to the sheet of its element with `insertRule`, which its
  // `textContent` does not show, so the rules are read from the sheet, and replaced after every typesetting.
  const { sheet: source } = api.chtmlStylesheet();
  sheet.replaceSync(source === null ? "" : Array.from(source.cssRules, (rule) => rule.cssText).join("\n"));
}

/** Returns the protocol of an absolute URL, or `undefined` for text that is not one; `URL.canParse` is outside the baseline. */
function protocolOf(url: string): string | undefined {
  try {
    return new URL(url).protocol;
  } catch {
    return undefined;
  }
}

function mathBelow(root: Element | ShadowRoot): Element[] {
  return [...root.querySelectorAll("math")].filter((math) => math.namespaceURI === MATHML_NAMESPACE);
}

/** Typesets the MathML of content roots with MathJax, which it loads from a URL when the first expression needs it. */
export interface MathTypesetter {
  /**
   * Typesets the MathML expressions below `root` in place, with the styles in the root when it is a shadow root. MathJax
   * is requested only when there is an expression; when there is none, nothing is loaded and the promise resolves.
   * An expression with elementary math (`mstack`, `mlongdiv` and the elements that go with them) stays MathML, which
   * the browser renders as MathML Core. When MathJax cannot be loaded the expressions stay MathML too, and the
   * promise rejects.
   *
   * @param root - A content root, or an element of one. A shadow root is typeset through its child elements, because
   * MathJax takes elements.
   * @throws `DataError` when `root` is not an element or a shadow root.
   * @throws `TempuhError` when MathJax cannot be loaded or the script is not MathJax 4.
   */
  typeset(root: Element | ShadowRoot): Promise<void>;
}

/**
 * Creates a typesetter that loads MathJax 4 from a URL, once. The host serves MathJax; tempuh bundles none. The URL is
 * that of the `mml-chtml.js` component, and the font package `@mathjax/mathjax-newcm-font` is served at `../@mathjax`
 * relative to it, as npm lays out `mathjax` and `@mathjax` side by side. MathJax is a global of the page, so a page
 * uses one URL.
 *
 * @param url - The absolute `http` or `https` URL of `mml-chtml.js`.
 * @throws `DataError` when `url` is not such a URL, or the page already loaded MathJax from another URL.
 */
export function createMathTypesetter(url: string): MathTypesetter {
  checkString(url, "The MathJax URL");
  const protocol = protocolOf(url);
  if (protocol !== "http:" && protocol !== "https:") {
    throw new DataError(`The MathJax URL must be an absolute http or https URL, found ${describe(url)}.`);
  }
  return {
    typeset: async (root) => {
      if (!(root instanceof Element || root instanceof ShadowRoot)) {
        throw new DataError(`The root to typeset must be an element or a shadow root, found ${describe(root)}.`);
      }
      if (mathBelow(root).length === 0) return;
      if (loading !== undefined && loading.url !== url) {
        throw new DataError(`The page loaded MathJax from ${loading.url}, so it cannot load it from ${url}.`);
      }
      loading ??= { url, api: loadScript(url) };
      const api = await loading.api;
      await api.typesetPromise(root instanceof ShadowRoot ? [...root.children] : [root]);
      const scope = root.getRootNode();
      if (scope instanceof ShadowRoot) adoptStyles(api, scope);
    },
  };
}
