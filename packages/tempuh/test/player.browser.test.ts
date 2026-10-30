import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { EN_MESSAGES, ID_MESSAGES } from "../src/messages/index.js";
import {
  MAX_PCI_HEIGHT,
  MIN_PCI_HEIGHT,
  mountPciFrame,
  type PciEvent,
  type PciFrame,
  type PciFrameOptions,
} from "../src/player/index.js";

const { asset, other, stranger } = inject("fixtures");
const PRESS = '<button id="press">Press</button><button id="done">Done</button><span class="dot"></span>';
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** A probe message: what code inside a frame reports to the test, which the player ignores. */
type Probe = Readonly<Record<string, unknown>> & { readonly probe: string };

interface Mounted {
  readonly frame: PciFrame;
  readonly events: PciEvent[];
  readonly probes: Probe[];
  readonly container: HTMLElement;
  /** Stops collecting probes. */
  readonly stop: () => void;
}

const mounted: Mounted[] = [];

/** The token of the test: the browsers of a run share the servers, so a test names its paths with a token of its own. */
let token = "";
beforeEach(() => {
  token = crypto.randomUUID();
});
const gate = () => `${asset}/g/${token}/`;

/** Mounts the interaction of `simple.js` in a frame, with the options replaced by the given ones. */
function mount(overrides: Partial<PciFrameOptions> = {}): Mounted {
  const events: PciEvent[] = [];
  const probes: Probe[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const frame = mountPciFrame(container, {
    staticUrl: `${asset}/static/`,
    messages: EN_MESSAGES,
    prompt: "Press the button.",
    language: "en",
    stylesheets: [`${gate()}styles/item.css`],
    markup: `<qti-interaction-markup>${PRESS}</qti-interaction-markup>`,
    modules: {
      baseUrl: `${gate()}modules/`,
      paths: new Map([["simple", [`${gate()}modules/simple`]]]),
      load: ["simple"],
    },
    typeIdentifier: "urn:test:simple",
    responseIdentifier: "RESPONSE",
    status: "interacting",
    boundTo: { base: null },
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  const collect = (event: MessageEvent): void => {
    const { data } = event;
    if (event.source === frame.element.contentWindow && typeof data === "object" && data !== null && "probe" in data) {
      probes.push(data);
    }
  };
  window.addEventListener("message", collect);
  const result = { frame, events, probes, container, stop: () => window.removeEventListener("message", collect) };
  mounted.push(result);
  return result;
}

const eventOf = <T extends PciEvent["type"]>(events: readonly PciEvent[], type: T) =>
  events.find((event): event is Extract<PciEvent, { type: T }> => event.type === type);

/** The ids of the elements that took the focus inside the frame, in order, which the interaction reports. */
const visited = ({ probes }: Mounted) => probes.filter(({ probe }) => probe === "focus").map(({ id }) => id);

/** Presses Tab until an element has the focus, and fails if six presses do not do it: Firefox stops at the frame itself too. */
async function tabTo(target: Element, shift = false): Promise<void> {
  for (let presses = 0; presses < 6 && document.activeElement !== target; presses++) await userEvent.tab({ shift });
  expect(document.activeElement).toBe(target);
}

const probeOf = (probes: readonly Probe[], name: string) => probes.find(({ probe }) => probe === name);

/** Waits until the interaction of the frame is ready. */
const ready = ({ events }: Mounted) =>
  vi.waitFor(() => expect(eventOf(events, "ready")).toBeDefined(), { timeout: 8000 });

/** Returns every path that a fixture server was asked for. */
async function requests(origin: string): Promise<string[]> {
  return (await fetch(`${origin}/__hits`, { cache: "no-store" })).json();
}

/** Returns the paths below the token of the test that a fixture server was asked for, without the token. */
async function hits(origin: string): Promise<string[]> {
  const prefix = new RegExp(`/${token}(?=/)`, "u");
  return (await requests(origin)).filter((path) => prefix.test(path)).map((path) => path.replace(prefix, ""));
}

afterEach(async () => {
  for (const { frame, container, stop } of mounted.splice(0)) {
    await frame.destroy();
    stop();
    container.remove();
  }
});

describe("mountPciFrame", () => {
  describe("the frame and RequireJS", () => {
    it("[T49] runs the interaction in a sandboxed frame of an opaque origin and loads its module with RequireJS", async () => {
      const result = mount();
      await ready(result);
      const { element } = result.frame;
      expect(element.getAttribute("sandbox")).toBe("allow-scripts");
      expect(element.src).toBe(`${asset}/static/pci-frame/frame.html`);
      expect(await requests(asset)).toEqual(
        expect.arrayContaining([
          "/static/pci-frame/frame.html",
          "/static/pci-frame/require.js",
          "/static/pci-frame/bridge.js",
        ]),
      );
      expect(await hits(asset)).toContain("/g/modules/simple.js");
      expect(element.contentDocument).toBeNull();
    });

    it("[T49] loads the second location when the first is missing", async () => {
      const result = mount({
        modules: {
          baseUrl: `${gate()}modules/`,
          paths: new Map([["simple", [`${gate()}missing/simple`, `${gate()}modules/simple`]]]),
          load: ["simple"],
        },
      });
      await ready(result);
      const paths = await hits(asset);
      expect(paths.indexOf("/g/missing/simple.js")).toBeGreaterThan(-1);
      expect(paths.indexOf("/g/modules/simple.js")).toBeGreaterThan(paths.indexOf("/g/missing/simple.js"));
    });

    it("[T49] loads the second location when the first does not answer within waitSeconds", async () => {
      const started = performance.now();
      const result = mount({
        modules: {
          baseUrl: `${gate()}modules/`,
          paths: new Map([["simple", [`${asset}/hang/${token}/simple`, `${gate()}modules/simple`]]]),
          waitSeconds: 1,
          load: ["simple"],
        },
      });
      await ready(result);
      expect(performance.now() - started).toBeGreaterThanOrEqual(1000);
      expect(await hits(asset)).toContain("/hang/simple.js");
    });

    it("[T49] resolves a relative dependency against the base URL under the prefix of the package", async () => {
      const result = mount({
        modules: {
          baseUrl: `${gate()}modules/`,
          paths: new Map([["relative", [`${gate()}modules/relative`]]]),
          load: ["relative"],
        },
        typeIdentifier: "urn:test:relative",
      });
      await ready(result);
      await vi.waitFor(() => expect(probeOf(result.probes, "relative")).toMatchObject({ helper: "helper-loaded" }));
      expect(await hits(asset)).toContain("/g/modules/helper.js");
    });

    it("[T49] resolves the relative url() of a stylesheet against the stylesheet under the prefix", async () => {
      const result = mount();
      await ready(result);
      await vi.waitFor(async () => expect(await hits(asset)).toContain("/g/images/dot.svg"));
      expect(probeOf(result.probes, "instance")).toMatchObject({ color: "rgb(10, 20, 30)" });
    });

    it("[T49] loads a module from an origin that is allowed, and from no other", async () => {
      const external = {
        baseUrl: `${gate()}modules/`,
        paths: new Map([
          ["external", [`${gate()}modules/external`]],
          ["cdn", [`${other}/cdn/${token}/cdn-module`]],
        ]),
        load: ["external"],
      };
      const allowed = mount({ modules: external, origins: [other], typeIdentifier: "urn:test:external" });
      await ready(allowed);
      expect(probeOf(allowed.probes, "external")).toMatchObject({ cdn: "cdn-loaded" });
      expect(await hits(other)).toEqual(["/cdn/cdn-module.js"]);

      const refused = mount({ modules: external, typeIdentifier: "urn:test:external" });
      await vi.waitFor(() => expect(eventOf(refused.events, "failed")).toEqual({ type: "failed", reason: "modules" }), {
        timeout: 8000,
      });
      // The refused frame asked for nothing: the one request is the allowed frame's.
      expect(await hits(other)).toEqual(["/cdn/cdn-module.js"]);
    });

    it("[T49] reports that no location of a module loads", async () => {
      const result = mount({
        modules: {
          baseUrl: `${gate()}modules/`,
          paths: new Map([["simple", [`${gate()}missing/simple`]]]),
          load: ["simple"],
        },
      });
      await vi.waitFor(() => expect(result.events).toEqual([{ type: "failed", reason: "modules" }]), { timeout: 8000 });
    });

    it("[T49] reports a module that registers no interaction of the type, and a factory that throws", async () => {
      const silent = mount({
        modules: {
          baseUrl: `${gate()}modules/`,
          paths: new Map([["unregistered", [`${gate()}modules/unregistered`]]]),
          load: ["unregistered"],
        },
      });
      const failing = mount({
        modules: {
          baseUrl: `${gate()}modules/`,
          paths: new Map([["throws", [`${gate()}modules/throws`]]]),
          load: ["throws"],
        },
        typeIdentifier: "urn:test:throws",
      });
      await vi.waitFor(() => expect(silent.events).toEqual([{ type: "failed", reason: "register" }]), {
        timeout: 8000,
      });
      await vi.waitFor(() => expect(failing.events).toEqual([{ type: "failed", reason: "instance" }]), {
        timeout: 8000,
      });
    });
  });

  describe("the configuration", () => {
    it("[T50] gives the interaction its properties, variables, markup, status and language", async () => {
      const result = mount({
        className: "qti-orientation-horizontal",
        language: "id",
        status: "review",
        properties: new Map([
          ["labelMin", "Very poorly"],
          ["__proto__", "data"],
        ]),
        templateVariables: new Map([["X", { base: { integer: 3 } }]]),
        contextVariables: new Map([["LIMIT", { list: { float: [1.5, 2.5] } }]]),
        boundTo: { base: { integer: 2 } },
        state: JSON.stringify({ count: 2 }),
      });
      await ready(result);
      const instance = probeOf(result.probes, "instance");
      expect(instance).toMatchObject({
        configuration: {
          properties: { labelMin: "Very poorly" },
          templateVariables: { X: { base: { integer: 3 } } },
          contextVariables: { LIMIT: { list: { float: [1.5, 2.5] } } },
          boundTo: { base: { integer: 2 } },
          responseIdentifier: "RESPONSE",
          status: "review",
        },
        state: '{"count":2}',
        className: "qti-orientation-horizontal",
        language: "id",
        title: "Press the button.",
      });
      expect(JSON.stringify(instance?.configuration)).toContain('"__proto__":"data"');
      expect(instance?.markup).toContain('<button id="press">Press</button>');
    });

    it("[T50] creates a new interaction without state", async () => {
      const result = mount();
      await ready(result);
      expect(probeOf(result.probes, "instance")).toMatchObject({
        state: null,
        configuration: { status: "interacting" },
      });
    });

    it("[T50] loads player.css, then the stylesheets of the item, in the frame", async () => {
      const result = mount();
      await ready(result);
      // player.css sets the text of the root to #1a1a1a; the stylesheet of the item, which comes after it, colors the button.
      expect(probeOf(result.probes, "instance")).toMatchObject({
        rootColor: "rgb(26, 26, 26)",
        color: "rgb(10, 20, 30)",
      });
    });

    it("[T50] takes every status that the item session has", async () => {
      for (const status of ["interacting", "suspended", "closed", "solution", "review"] as const) {
        const result = mount({ status });
        await ready(result);
        expect(probeOf(result.probes, "instance")).toMatchObject({ configuration: { status } });
      }
    });
  });

  describe("the events", () => {
    it("[T52] tells that the interaction is ready, with its state", async () => {
      const result = mount({ state: JSON.stringify({ count: 4 }) });
      await ready(result);
      expect(eventOf(result.events, "ready")).toEqual({ type: "ready", state: '{"count":4}' });
    });

    it("[T52] turns qti-interaction-changed into the response and the state", async () => {
      const result = mount();
      await ready(result);
      await commands.clickInFrame("Press the button.", "#press");
      await vi.waitFor(() =>
        expect(eventOf(result.events, "changed")).toEqual({
          type: "changed",
          response: { base: { integer: 1 } },
          state: '{"count":1}',
          valid: true,
        }),
      );
    });

    it("[T52] restores the state that getState gave", async () => {
      const result = mount({ state: JSON.stringify({ count: 2 }) });
      await ready(result);
      await commands.clickInFrame("Press the button.", "#press");
      await vi.waitFor(() =>
        expect(eventOf(result.events, "changed")).toMatchObject({ response: { base: { integer: 3 } } }),
      );
    });

    it("[T52] passes ondone with the status that the interaction asks for, and null for no response", async () => {
      const result = mount();
      await ready(result);
      await commands.clickInFrame("Press the button.", "#done");
      await vi.waitFor(() =>
        expect(eventOf(result.events, "done")).toEqual({
          type: "done",
          response: null,
          state: '{"count":0}',
          status: "solution",
        }),
      );
    });

    it("[T52] asks the validity methods of the interaction", async () => {
      const result = mount();
      await ready(result);
      expect(await result.frame.checkValidity()).toBe(false);
      await commands.clickInFrame("Press the button.", "#press");
      await vi.waitFor(async () => expect(await result.frame.checkValidity()).toBe(true));
      expect(await result.frame.reportValidity()).toBe(true);
      expect(probeOf(result.probes, "reportValidity")).toBeDefined();
      expect(await result.frame.getCustomValidity()).toBe("");
      await result.frame.setCustomValidity("Press once more.");
      expect(await result.frame.getCustomValidity()).toBe("Press once more.");
    });

    it("[T52] refuses a custom validity message that is not a string", async () => {
      const result = mount();
      await expect(result.frame.setCustomValidity(JSON.parse("5"))).rejects.toThrow(
        "The custom validity message must be a string, found 5.",
      );
    });

    it("[T52] gives no verdict when the interaction is not running", async () => {
      const result = mount({
        modules: {
          baseUrl: `${gate()}modules/`,
          paths: new Map([["simple", [`${gate()}missing/simple`]]]),
          load: ["simple"],
        },
      });
      expect(await result.frame.checkValidity()).toBeUndefined();
      await vi.waitFor(() => expect(eventOf(result.events, "failed")).toBeDefined(), { timeout: 8000 });
      expect(await result.frame.getCustomValidity()).toBeUndefined();
    });

    it("[T52] hands over the response and the state, then calls oncompleted, when the frame goes", async () => {
      const result = mount({ state: JSON.stringify({ count: 2 }) });
      await ready(result);
      await result.frame.destroy();
      expect(eventOf(result.events, "completed")).toEqual({
        type: "completed",
        response: { base: { integer: 2 } },
        state: '{"count":2}',
      });
      const completed = probeOf(result.probes, "oncompleted");
      expect(completed?.calls).toEqual(["getState", "getResponse", "getState", "oncompleted"]);
      expect(result.container.querySelector("iframe")).toBeNull();
    });

    it("[T52] removes a frame that never started, and does it once", async () => {
      const result = mount();
      const first = result.frame.destroy();
      expect(result.frame.destroy()).toBe(first);
      await first;
      expect(result.container.querySelector("iframe")).toBeNull();
      expect(await result.frame.checkValidity()).toBeUndefined();
      expect(result.events).toEqual([]);
    });
  });

  describe("the markup", () => {
    it("[T53] runs no script of the markup", async () => {
      const result = mount({
        markup: [
          '<img src="data:," alt="" onerror="parent.postMessage({ probe: \'onerror\' }, \'*\')">',
          "<script>parent.postMessage({ probe: 'script' }, '*')</script>",
          PRESS,
        ].join(""),
      });
      await ready(result);
      await new Promise((done) => setTimeout(done, 300));
      expect(result.probes.map(({ probe }) => probe)).not.toContain("onerror");
      expect(result.probes.map(({ probe }) => probe)).not.toContain("script");
    });
  });

  describe("the height", () => {
    it("[T49] sets the height of the frame to the height of its content", async () => {
      const result = mount({ markup: '<div style="height: 300px"></div>' });
      await vi.waitFor(() => {
        const height = result.frame.element.getBoundingClientRect().height;
        expect(height).toBeGreaterThanOrEqual(300);
        expect(height).toBeLessThan(340);
      });
    });

    it("[T49] keeps the height between the least and the greatest", async () => {
      const small = mount({ markup: "" });
      await ready(small);
      expect(small.frame.element.getBoundingClientRect().height).toBe(MIN_PCI_HEIGHT);
      const tall = mount({ markup: '<div style="height: 6000px"></div>' });
      await vi.waitFor(() => expect(tall.frame.element.getBoundingClientRect().height).toBe(MAX_PCI_HEIGHT));
    });
  });

  describe("options", () => {
    it("[T49] refuses a parent that is not an element and options that are not valid", () => {
      const parent = document.createElement("div");
      const options: PciFrameOptions = {
        staticUrl: `${asset}/static/`,
        messages: EN_MESSAGES,
        prompt: null,
        language: "en",
        stylesheets: [],
        markup: "",
        modules: { baseUrl: gate(), paths: new Map(), load: [] },
        typeIdentifier: "urn:test:simple",
        responseIdentifier: "RESPONSE",
        status: "interacting",
        boundTo: { base: null },
        onEvent: () => undefined,
      };
      expect(() => mountPciFrame(JSON.parse("null"), options)).toThrow("The parent must be an element, found null.");
      expect(() => mountPciFrame(parent, JSON.parse('{"staticUrl":"x"}'))).toThrow(/staticUrl/u);
      expect(() => mountPciFrame(parent, { ...options, staticUrl: "https://cdn.example/static" })).toThrow(
        'The option staticUrl must end in "/"',
      );
      expect(parent.childElementCount).toBe(0);
    });
  });
});

describe("the frame", () => {
  describe("the policy", () => {
    it("[T53] reaches no network, no parent, no storage and no other window", async () => {
      const result = mount({
        modules: {
          baseUrl: `${gate()}modules/`,
          paths: new Map([["hostile", [`${gate()}modules/hostile`]]]),
          load: ["hostile"],
        },
        typeIdentifier: "urn:test:hostile",
        properties: new Map([["evil", stranger]]),
      });
      const location = window.location.href;
      await vi.waitFor(() => expect(probeOf(result.probes, "hostile")).toBeDefined(), { timeout: 10000 });
      expect(probeOf(result.probes, "hostile")?.results).toEqual({
        fetch: "blocked",
        xhr: "blocked",
        webSocket: "blocked",
        eventSource: "blocked",
        image: "blocked",
        script: "blocked",
        stylesheet: "blocked",
        dynamicImport: "blocked",
        eval: "blocked",
        parentDocument: "blocked",
        parentLocation: "blocked",
        topLocation: "blocked",
        localStorage: "blocked",
        sessionStorage: "blocked",
        cookie: "blocked",
        indexedDb: "blocked",
        popup: "blocked",
      });
      await new Promise((done) => setTimeout(done, 500));
      expect(await requests(stranger)).toEqual([]);
      expect(window.location.href).toBe(location);
      expect(window.localStorage.getItem("stolen")).toBeNull();
    });

    it("[T53] drops forged messages and bounds a forged height", async () => {
      const result = mount({
        modules: {
          baseUrl: `${gate()}modules/`,
          paths: new Map([["forger", [`${gate()}modules/forger`]]]),
          load: ["forger"],
        },
        typeIdentifier: "urn:test:forger",
      });
      await vi.waitFor(() => expect(result.frame.element.style.height).toBe(`${MAX_PCI_HEIGHT}px`), { timeout: 5000 });
      expect(result.events).toEqual([{ type: "ready", state: "{}" }]);
    });

    it("[T53] ignores a message that does not come from the frame", async () => {
      const result = mount();
      await ready(result);
      window.postMessage({ type: "changed", response: { base: { integer: 9 } }, state: "{}" }, "*");
      window.postMessage({ type: "height", height: 3000 }, "*");
      await new Promise((done) => setTimeout(done, 200));
      expect(eventOf(result.events, "changed")).toBeUndefined();
      expect(result.frame.element.style.height).not.toBe("3000px");
    });

    it("[T53] does not start the interaction where the browser sets no policy", async () => {
      const result = mount({ staticUrl: `${asset}/unrestricted/` });
      await vi.waitFor(() => expect(result.events).toEqual([{ type: "failed", reason: "csp" }]), { timeout: 8000 });
      expect(await hits(asset)).not.toContain("/g/modules/simple.js");
    });
  });

  describe("the name and the focus", () => {
    it("[SC 4.1.2] names the frame from the prompt of the interaction, else by a message", () => {
      const prompt = mount({ prompt: "  Press   the\n button. " });
      const none = mount({ prompt: null });
      const blank = mount({ prompt: " \n " });
      const indonesian = mount({ prompt: null, messages: ID_MESSAGES });
      expect(prompt.frame.element.title).toBe("Press the button.");
      expect(none.frame.element.title).toBe("Interactive question");
      expect(blank.frame.element.title).toBe("Interactive question");
      expect(indonesian.frame.element.title).toBe("Soal interaktif");
    });

    it("[SC 4.1.2] has no axe violation on the frame element, and none inside the frame", async () => {
      const axe = (await import("axe-core")).default;
      const result = mount();
      await ready(result);
      const outside = await axe.run(result.container, { runOnly: { type: "tag", values: WCAG_TAGS } });
      expect(outside.violations).toEqual([]);
      expect(await commands.axeInFrame("Press the button.", WCAG_TAGS)).toEqual([]);
    });

    it("[SC 4.1.2] exposes the controls of the frame in the accessibility tree, below the frame", async () => {
      const result = mount();
      await ready(result);
      await vi.waitFor(async () => {
        const tree = await commands.ariaSnapshot();
        expect(tree).toMatch(/- iframe[^\n]*:\n(?:.*\n)*?\s+- button "Press"/u);
        expect(tree).toMatch(/- button "Done"/u);
      });
    });

    it("[SC 2.1.2] lets the focus enter the frame and leave it, forward and back", async () => {
      // Text fields, because Safari's default is to skip buttons when Tab moves the focus.
      const field = (label: string): HTMLInputElement => {
        const input = document.createElement("input");
        input.setAttribute("aria-label", label);
        return input;
      };
      const before = field("Before");
      const after = field("After");
      const result = mount({
        markup: '<input id="first" aria-label="First"><input id="second" aria-label="Second">',
      });
      result.container.before(before);
      result.container.after(after);
      await ready(result);
      await userEvent.click(before);

      await tabTo(after);
      await vi.waitFor(() => expect(visited(result)).toEqual(["first", "second"]));
      // Going back, the frame ends at its first field; Firefox does not report a second visit to the second.
      await tabTo(before, true);
      await vi.waitFor(() => expect(visited(result).at(-1)).toBe("first"));
      before.remove();
      after.remove();
    });
  });
});
