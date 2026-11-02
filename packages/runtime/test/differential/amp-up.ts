import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { longsightRandom } from "./longsight.js";
import type { ItemCase, ItemRunner, Observed, Run, Scalar } from "./model.js";

/** A variable of the item state that the player reports, as far as the comparison reads it. */
interface StateVariable {
  readonly identifier: string;
  readonly value: unknown;
}

/** The item state of the player: its response, outcome and template variables. */
interface ItemState {
  readonly responseVariables: readonly StateVariable[];
  readonly outcomeVariables: readonly StateVariable[];
  readonly templateVariables: readonly StateVariable[];
}

/** The calls of the player component that the comparison uses (`qti3-item-player`). */
interface Player {
  loadItemFromXml(xml: string, configuration: { readonly state?: ItemState }): void;
  resetItem(): void;
  suspendAttempt(target: string): void;
  scoreAttempt(target: string): void;
}

/** The parts of Vue 2 that the harness sets, and the component it mounts. */
interface VueConstructor {
  readonly config: {
    async: boolean;
    productionTip: boolean;
    devtools: boolean;
    errorHandler: (error: unknown) => void;
    warnHandler: (message: string) => void;
  };
  new (options: {
    render: (create: (component: unknown, data: unknown) => unknown) => unknown;
  }): {
    $mount(selector: string): unknown;
  };
}

/** What the page has seen of the player since the last item was loaded. */
interface Events {
  ready: boolean;
  state: ItemState | null;
  readonly problems: string[];
  readonly unknownElements: Set<string>;
}

/** The window with the player, and what it reports. */
interface Page {
  readonly player: Player;
  readonly events: Events;
  /** The `Math` of the window, whose `random` the player draws template values with. */
  readonly math: { random: () => number };
}

/** The start of the reason that the runner gives for an item that holds an element the player does not know. */
export const UNSUPPORTED = "The player does not know the element";

const UNKNOWN_ELEMENT = /Unknown custom element: <([^>]+)>/;

const require = createRequire(import.meta.url);

/**
 * What jsdom lacks. The rich text editor of the extended text interaction calls `execCommand` when the document loads, and a
 * portable custom interaction asks `fetch` for its modules; no module arrives, so the interaction never starts and the case
 * gives the response in place of the candidate.
 */
const MISSING_APIS = `
  document.execCommand = function () { return false; };
  window.fetch = function () { return new Promise(function () {}); };
  // The player logs every step to the console.
  console.log = function () {};
`;

/** Mounts the player in a window without a screen and returns its calls and what it reports. */
function createPage(): Page {
  const { window } = new JSDOM('<!doctype html><body><div id="app"></div></body>', {
    runScripts: "outside-only",
    url: "http://localhost/",
  });
  window.eval(MISSING_APIS);
  window.eval(readFileSync(require.resolve("vue/dist/vue.js"), "utf8"));
  window.eval(readFileSync(require.resolve("qti3-item-player"), "utf8"));
  const vue = window.eval<VueConstructor>("Vue");
  const component = window.eval("qti3Player.default || qti3Player");
  const events: Events = { ready: false, state: null, problems: [], unknownElements: new Set() };
  vue.config.productionTip = false;
  vue.config.devtools = false;
  // Vue renders at once instead of in the next tick, so that loading an item and scoring it are plain calls.
  vue.config.async = false;
  vue.config.errorHandler = (error) => {
    events.problems.push(error instanceof Error ? error.message : String(error));
  };
  vue.config.warnHandler = (message) => {
    const name = UNKNOWN_ELEMENT.exec(message)?.[1];
    // Elements of other namespaces (MathML, SSML) are markup that the player passes through.
    if (name?.startsWith("qti-")) events.unknownElements.add(name);
  };
  let player: Player | undefined;
  const reportState = ({ state }: { state: ItemState }) => {
    events.state = state;
  };
  new vue({
    render: (create) =>
      create(component, {
        on: {
          notifyQti3PlayerReady: (ready: Player) => {
            player = ready;
          },
          notifyQti3ItemReady: () => {
            events.ready = true;
          },
          notifyQti3SuspendAttemptCompleted: reportState,
          notifyQti3ScoreAttemptCompleted: reportState,
        },
      }),
  }).$mount("#app");
  if (player === undefined) throw new Error("The player did not mount.");
  return { player, events, math: window.eval<Page["math"]>("Math") };
}

let page: Page | undefined;

/** Loads an item, with a prior state or without, and returns why the player does not accept it. */
function load(current: Page, xml: string, state?: ItemState): string | null {
  const { player, events } = current;
  events.ready = false;
  events.state = null;
  events.problems.length = 0;
  events.unknownElements.clear();
  // The player renders again only when the document differs from the one it holds, and a restored state is a reload.
  player.resetItem();
  player.loadItemFromXml(xml, state === undefined ? {} : { state });
  if (events.unknownElements.size > 0) return `${UNSUPPORTED} ${[...events.unknownElements].sort().join(", ")}.`;
  if (!events.ready) return events.problems.join("; ") || "The item did not load.";
  return null;
}

/** Calls the player and returns the state it reports. */
function report(current: Page, call: "suspendAttempt" | "scoreAttempt"): ItemState {
  current.events.state = null;
  current.player[call](call);
  if (current.events.state === null) throw new Error(`The player reported no state to ${call}.`);
  return current.events.state;
}

/** Returns a scalar of the player, which reports numbers, booleans and text for every base type it keeps. */
function scalar(value: unknown): Scalar {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new Error(`The player reports ${JSON.stringify(value)} where a value of a base type belongs.`);
}

/** Returns a value of the player in the neutral form: absent is NULL, a container is a list. */
function observe(value: unknown): Observed {
  if (value === undefined || value === null) return null;
  return Array.isArray(value) ? value.map(scalar) : scalar(value);
}

/** Returns the values of variables by identifier. */
function observeAll(variables: readonly StateVariable[]): Record<string, Observed> {
  return Object.fromEntries(variables.map(({ identifier, value }) => [identifier, observe(value)]));
}

/**
 * Returns the state of the item with the responses of a case in place of what the player holds: the player scores the state
 * it restores, and the state of each interaction (the order of its choices) stays as the player made it.
 */
function withResponses(state: ItemState, responses: ItemCase["responses"]): ItemState {
  return {
    ...state,
    responseVariables: state.responseVariables.map((variable) =>
      variable.identifier in responses ? { ...variable, value: responses[variable.identifier] } : variable,
    ),
  };
}

/**
 * Amp-up.io `qti3-item-player`, the second oracle for items: the Vue 2 component that is certified for QTI 3 Advanced
 * delivery, run in a window without a screen. The player loads the item and its interactions make their state; the
 * responses of the case replace the response values of that state, which the player restores and scores with `scoreAttempt`,
 * as a scoring system does with the state of a candidate. The player draws template values with `Math.random`, which the
 * window gets from the seeded generator of the other oracle. An item is not accepted when it holds a `qti-` element that
 * the player does not know, or when the player throws while it loads or scores the item.
 */
export const ampUp: ItemRunner = {
  name: "Amp-up qti3-item-player",
  run: ({ xml, responses, seed }: ItemCase): Run => {
    page ??= createPage();
    const current = page;
    current.math.random = longsightRandom(seed).uniform;
    try {
      const rejected = load(current, xml);
      if (rejected !== null) return { accepted: false, reason: rejected };
      if (Object.keys(responses).length > 0) {
        const restored = load(current, xml, withResponses(report(current, "suspendAttempt"), responses));
        if (restored !== null) return { accepted: false, reason: restored };
      }
      const state = report(current, "scoreAttempt");
      return {
        accepted: true,
        observation: {
          outcomes: observeAll(state.outcomeVariables),
          templateValues: observeAll(state.templateVariables),
        },
      };
    } catch (error) {
      // The player throws from its processing where an expression or a value is not what it can process.
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
