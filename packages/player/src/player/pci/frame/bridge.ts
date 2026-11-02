/**
 * The program that runs inside the frame of a portable custom interaction.
 *
 * @remarks
 * It restricts the frame, builds its document, loads the modules with RequireJS and provides the communication bridge
 * `qtiCustomInteractionContext`, and it reports to the player with messages. `pnpm build` bundles it with its imports into
 * the classic script `bridge.js`, because a module script of an opaque origin needs CORS headers on the static files.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 */
import { applyPresentation } from "../../presentation/index.js";
import { buildFrameCsp } from "../csp.js";
import {
  isRequestedStatus,
  type PciCommand,
  type PciFailure,
  type PciFrameMessage,
  type PciStart,
  type PciValidityResult,
} from "../protocol.js";

/** What `require.js` puts on the window. */
interface RequireGlobals {
  requirejs: {
    (names: readonly string[], onLoad: () => void, onError: (error: Error) => void): void;
    config(options: {
      readonly baseUrl: string;
      readonly paths: Readonly<Record<string, readonly string[]>>;
      readonly waitSeconds: number;
    }): void;
  };
  define(name: string, dependencies: readonly string[], factory: () => unknown): void;
}

declare global {
  interface Window extends RequireGlobals {
    /** The communication bridge, which interactions find on the window when they do not ask for the AMD module. */
    qtiCustomInteractionContext: unknown;
  }
}

/** The element that holds the markup, as the interaction is in the item. */
const INTERACTION = "qti-portable-custom-interaction";

/**
 * The event that an interaction fires when its response changes.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 */
const CHANGED = "qti-interaction-changed";

/** The registered factories, by `typeIdentifier`. */
const factories = new Map<string, unknown>();

let started = false;
let completing = false;
let instance: object | undefined;

// The target origin is "*" because the frame cannot know the origin of the player.
function send(message: PciFrameMessage): void {
  try {
    window.parent.postMessage(message, "*");
  } catch {
    // A value that a structured clone cannot copy never reaches the player.
  }
}

const fail = (reason: PciFailure): void => send({ type: "failed", reason });

function read(target: unknown, name: string): unknown {
  return typeof target === "object" && target !== null ? Reflect.get(target, name) : undefined;
}

/** Calls a method of an object that is not ours, and gives `undefined` when it has none. */
function call(target: unknown, name: string, ...args: readonly unknown[]): unknown {
  const method = read(target, name);
  return typeof method === "function" ? Reflect.apply(method, target, args) : undefined;
}

const stateOf = (value: unknown): string => (typeof value === "string" ? value : "");

/** The response and the state of an interaction, which the player stores together. */
function snapshot(interaction: unknown): { readonly response: unknown; readonly state: string } {
  return { response: call(interaction, "getResponse"), state: stateOf(call(interaction, "getState")) };
}

const context = {
  register(factory: unknown): void {
    const typeIdentifier = read(factory, "typeIdentifier");
    if (typeof typeIdentifier === "string" && typeof read(factory, "getInstance") === "function") {
      factories.set(typeIdentifier, factory);
    }
  },
  getInstance(typeIdentifier: string, dom: HTMLElement, configuration: unknown, state?: string): unknown {
    return call(factories.get(typeIdentifier), "getInstance", dom, configuration, state);
  },
};

/** Restricts the frame with the policy of {@link buildFrameCsp}, and says whether the browser enforces it. */
function restrict(origins: readonly string[]): Promise<boolean> {
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = buildFrameCsp(new URL(location.href).origin, origins);
  document.head.append(policy);
  // A script from a data: URL is outside `script-src`; if it loads, no policy is in force.
  return new Promise((resolve) => {
    const probe = document.createElement("script");
    const settle = (enforced: boolean): void => {
      probe.remove();
      resolve(enforced);
    };
    probe.addEventListener("load", () => settle(false));
    probe.addEventListener("error", () => settle(true));
    probe.src = "data:text/javascript,0";
    document.head.append(probe);
  });
}

function reportHeight(): void {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  send({ type: "height", height });
}

/** Adds the stylesheets, and resolves when each has loaded or failed, so that an interaction measures a styled layout. */
function addStylesheets(hrefs: readonly string[]): Promise<void> {
  const settled = hrefs.map(
    (href) =>
      new Promise<void>((resolve) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.addEventListener("load", () => resolve());
        link.addEventListener("error", () => resolve());
        link.href = href;
        document.head.append(link);
      }),
  );
  return Promise.all(settled).then(() => undefined);
}

function buildDocument(command: PciStart): HTMLElement {
  const dom = document.createElement(INTERACTION);
  dom.className = command.className;
  // The policy allows no inline script, so markup cannot run script.
  dom.innerHTML = command.markup;
  document.body.append(dom);
  return dom;
}

function onChanged(event: Event): void {
  const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
  const interaction = read(detail, "interaction") ?? instance;
  const valid = read(detail, "valid");
  try {
    send({
      type: "changed",
      ...snapshot(interaction),
      valid: typeof valid === "boolean" ? valid : undefined,
    });
  } catch {
    // The interaction threw; the player keeps the last response it has.
  }
}

/**
 * Returns the key of the factory for an interaction: its type identifier, or else the one factory that the modules
 * registered.
 *
 * @remarks
 * The 1EdTech examples need the second: the item of `pci-simple` names `urn-fdc-hmhco.com-pci-tapToReveal` for a module
 * that registers `urn:fdc:hmhco.com:pci:tapToReveal`.
 */
function factoryKey(typeIdentifier: string): string | undefined {
  if (factories.has(typeIdentifier)) return typeIdentifier;
  const keys = [...factories.keys()];
  return keys.length === 1 ? keys[0] : undefined;
}

function create(command: PciStart, dom: HTMLElement): void {
  const key = factoryKey(command.typeIdentifier);
  if (key === undefined) {
    fail("register");
    return;
  }
  const configuration = {
    properties: Object.fromEntries(command.properties),
    templateVariables: Object.fromEntries(command.templateVariables),
    contextVariables: Object.fromEntries(command.contextVariables),
    boundTo: command.boundTo,
    responseIdentifier: command.responseIdentifier,
    status: command.status,
    onready: (_interaction: unknown, state: unknown) => send({ type: "ready", state: stateOf(state) }),
    ondone: (_interaction: unknown, response: unknown, state: unknown, status?: unknown) =>
      send({
        type: "done",
        response,
        state: stateOf(state),
        status: isRequestedStatus(status) ? status : "interacting",
      }),
  };
  try {
    const created = context.getInstance(key, dom, configuration, command.state ?? undefined);
    if (typeof created !== "object" || created === null) throw new TypeError("An interaction is an object.");
    instance = created;
  } catch {
    fail("instance");
  }
}

function load(command: PciStart, dom: HTMLElement, styled: Promise<void>): void {
  window.qtiCustomInteractionContext = context;
  window.define("qtiCustomInteractionContext", [], () => context);
  const { baseUrl, paths, waitSeconds, load: names } = command.modules;
  window.requirejs.config({
    baseUrl,
    paths: Object.fromEntries([...paths].map(([name, locations]) => [name, [...locations]])),
    waitSeconds,
  });
  window.requirejs(
    names,
    () => {
      void styled.then(() => {
        if (!completing) create(command, dom);
      });
    },
    () => fail("modules"),
  );
}

async function start(command: PciStart): Promise<void> {
  if (!(await restrict(command.origins))) {
    fail("csp");
    return;
  }
  document.documentElement.lang = command.language;
  document.title = command.title;
  applyPresentation(document.documentElement, command.presentation);
  const styled = addStylesheets(command.stylesheets);
  const dom = buildDocument(command);
  new ResizeObserver(reportHeight).observe(document.documentElement);
  dom.addEventListener(CHANGED, onChanged);
  load(command, dom, styled);
}

/** Answers a validity request; an interaction without the method, or one that throws, gives no verdict. */
function answer(command: Extract<PciCommand, { readonly type: "validity" }>): void {
  const given: readonly unknown[] = command.message === undefined ? [] : [command.message];
  let value: PciValidityResult;
  try {
    const result = call(instance, command.method, ...given);
    value = typeof result === "boolean" || typeof result === "string" ? result : undefined;
  } catch {
    value = undefined;
  }
  send({ type: "validity", id: command.id, value });
}

/** Answers a snapshot request with the response and the state; an interaction that throws, or none, gives `null`. */
function answerSnapshot(id: number): void {
  let flushed: { readonly response: unknown; readonly state: string } | null = null;
  try {
    if (instance !== undefined && !completing) flushed = snapshot(instance);
  } catch {
    // The interaction threw; the player keeps the last response it has.
  }
  send({ type: "snapshot", id, flushed });
}

/** Hands over the response and state, then lets the interaction clean up: getResponse and getState come before oncompleted. */
function complete(): void {
  completing = true;
  let flushed: { readonly response: unknown; readonly state: string } | null = null;
  try {
    if (instance !== undefined) flushed = snapshot(instance);
  } catch {
    // The interaction threw; the player keeps the last response it has.
  }
  try {
    call(instance, "oncompleted");
  } finally {
    send({ type: "completed", flushed });
  }
}

window.addEventListener("message", (event: MessageEvent<PciCommand>) => {
  if (event.source !== window.parent) return;
  const command = event.data;
  if (command.type === "start" && !started && !completing) {
    started = true;
    void start(command);
  } else if (command.type === "presentation") {
    applyPresentation(document.documentElement, command.presentation);
  } else if (command.type === "validity") {
    answer(command);
  } else if (command.type === "snapshot") {
    answerSnapshot(command.id);
  } else if (command.type === "complete") {
    complete();
  }
});

send({ type: "loaded" });
