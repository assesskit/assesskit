import { DataError } from "@assesskit/runtime/errors";
import { container, single, type Value } from "@assesskit/runtime/values";
import { describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { ID_MESSAGES } from "../src/messages/id/index.js";
import { EN_MESSAGES } from "../src/messages/index.js";
import {
  MAX_PCI_HEIGHT,
  MIN_PCI_HEIGHT,
  mountPciFrame,
  type PciEvent,
  type PciFiles,
  type PciFrameOptions,
  presentationOf,
} from "../src/player/index.js";
import type { FrameTheme } from "./fixtures/commands.js";
import {
  asset,
  assets,
  eventOf,
  hits,
  INTEGER,
  interactionOf,
  type Mounted,
  memoryFiles,
  mount,
  other,
  PRESS,
  probeOf,
  ready,
  requests,
  resolution,
  SIMPLE,
  stranger,
  tokenOf,
} from "./pci-fixture.js";
import { WCAG_TAGS } from "./renderer-fixture.js";
import { onSupport } from "./supports-fixture.js";
import { waitFor } from "./wait.js";

const TITLE = "Press the button.";
const FILE = { cardinality: "single", baseType: "file" } as const;

/** The ids of the elements that took the focus inside the frame, in order, which the interaction reports. */
const visited = ({ probes }: Mounted) => probes.filter(({ probe }) => probe === "focus").map(({ id }) => id);

/** Presses Tab until an element has the focus, and fails if six presses do not do it: Firefox stops at the frame itself too. */
async function tabTo(target: Element, shift = false): Promise<void> {
  for (let presses = 0; presses < 6 && document.activeElement !== target; presses++) await userEvent.tab({ shift });
  expect(document.activeElement).toBe(target);
}

/** The events of a type, in order. */
const eventsOf = <T extends PciEvent["type"]>({ events }: Mounted, type: T) =>
  events.filter((event): event is Extract<PciEvent, { type: T }> => event.type === type);

/** The buttons of `files.js`: each gives a response. */
const GIVE = '<button id="give">Give</button><button id="same">Same</button><button id="bad">Bad</button>';

/** The options for the interaction of `files.js`, whose response variable is a file. */
const filesPci = (files: PciFiles, value: Value | null = null): Partial<PciFrameOptions> => ({
  interaction: interactionOf('module="files" custom-interaction-type-identifier="urn:test:files"'),
  configuration: { primary: resolution({ files: "modules/files" }) },
  markup: GIVE,
  response: { value, declaration: FILE },
  files,
});

/** The configuration that locates the module at a path that the server lacks. */
const FAILING = { primary: resolution({ simple: "missing/simple" }) };

describe("mountPciFrame", () => {
  describe("the frame and RequireJS", () => {
    it("runs the interaction in a sandboxed frame of an opaque origin and loads its module with RequireJS", async () => {
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

    it("resolves a relative URL of the package against the base URL of the page, so that the frame gets an absolute one", async () => {
      const base = document.createElement("base");
      base.href = `${asset}/`;
      document.head.append(base);
      let result: Mounted;
      try {
        result = mount({ assets: (path) => `/g/${tokenOf()}/${path}` });
      } finally {
        base.remove();
      }
      await ready(result);
      expect(await hits(asset)).toContain("/g/modules/simple.js");
    });

    it("refuses at mount a file of the package on an origin that the frame does not load scripts from", () => {
      // The page is not on the origin of staticUrl, so `/g/…` is a file that the policy of the frame would block.
      const relative = (path: string): string => `/g/${tokenOf()}/${path}`;
      expect(() => mount({ assets: relative })).toThrow(
        new DataError(
          `The URL ${JSON.stringify(`${window.location.origin}${relative("modules/simple")}`)} of a file of the package is on the origin ${window.location.origin}, which the frame does not load scripts from (${asset}). Serve the files of the package from the origin of staticUrl, or add its origin to origins.`,
        ),
      );
      expect(() => mount({ assets: relative, origins: [window.location.origin] })).not.toThrow();
    });

    it("loads the second location when the first is missing", async () => {
      const result = mount({
        configuration: {
          primary: resolution({ simple: "missing/simple" }),
          fallback: resolution({ simple: "modules/simple" }),
        },
      });
      await ready(result);
      const paths = await hits(asset);
      expect(paths.indexOf("/g/missing/simple.js")).toBeGreaterThan(-1);
      expect(paths.indexOf("/g/modules/simple.js")).toBeGreaterThan(paths.indexOf("/g/missing/simple.js"));
    });

    it("loads the second location when the first does not answer within waitSeconds", async () => {
      const started = performance.now();
      const result = mount({
        configuration: {
          primary: resolution({ simple: `${asset}/hang/${tokenOf()}/simple` }, 1),
          fallback: resolution({ simple: "modules/simple" }),
        },
      });
      await ready(result);
      expect(performance.now() - started).toBeGreaterThanOrEqual(1000);
      expect(await hits(asset)).toContain("/hang/simple.js");
    });

    it("resolves a relative dependency against the base URL under the prefix of the package", async () => {
      const result = mount({
        interaction: interactionOf('module="relative" custom-interaction-type-identifier="urn:test:relative"'),
        configuration: { primary: resolution({ relative: "modules/relative" }) },
      });
      await ready(result);
      await waitFor(() => expect(probeOf(result.probes, "relative")).toMatchObject({ helper: "helper-loaded" }));
      expect(await hits(asset)).toContain("/g/modules/helper.js");
    });

    it("resolves the relative url() of a stylesheet against the stylesheet under the prefix", async () => {
      const result = mount();
      await ready(result);
      await waitFor(async () => expect(await hits(asset)).toContain("/g/images/dot.svg"));
      expect(probeOf(result.probes, "instance")).toMatchObject({ color: "rgb(10, 20, 30)" });
    });

    it("loads a module from an origin that is allowed, and from no other", async () => {
      const external = {
        interaction: interactionOf('module="external" custom-interaction-type-identifier="urn:test:external"'),
        configuration: {
          primary: resolution({ external: "modules/external", cdn: `${other}/cdn/${tokenOf()}/cdn-module` }),
        },
      };
      const allowed = mount({ ...external, origins: [other] });
      await ready(allowed);
      expect(probeOf(allowed.probes, "external")).toMatchObject({ cdn: "cdn-loaded" });
      expect(await hits(other)).toEqual(["/cdn/cdn-module.js"]);

      const refused = mount(external);
      await waitFor(() => expect(eventOf(refused.events, "failed")).toEqual({ type: "failed", reason: "modules" }));
      // The refused frame asked for nothing: the one request is the allowed frame's.
      expect(await hits(other)).toEqual(["/cdn/cdn-module.js"]);
    });

    it("reports that no location of a module loads", async () => {
      const result = mount({ configuration: FAILING });
      await waitFor(() => expect(result.events).toEqual([{ type: "failed", reason: "modules" }]));
    });

    it("reports a module that registers no interaction, and a factory that throws", async () => {
      const silent = mount({
        interaction: interactionOf('module="unregistered" custom-interaction-type-identifier="urn:test:none"'),
        configuration: { primary: resolution({ unregistered: "modules/unregistered" }) },
      });
      const failing = mount({
        interaction: interactionOf('module="throws" custom-interaction-type-identifier="urn:test:throws"'),
        configuration: { primary: resolution({ throws: "modules/throws" }) },
      });
      await waitFor(() => expect(silent.events).toEqual([{ type: "failed", reason: "register" }]));
      await waitFor(() => expect(failing.events).toEqual([{ type: "failed", reason: "instance" }]));
    });

    it("starts the one interaction that the modules register under another identifier, and no interaction of several", async () => {
      // The pci-simple example of 1EdTech names a type identifier that its module does not register.
      const renamed = mount({
        interaction: interactionOf('module="simple" custom-interaction-type-identifier="urn-test-simple"'),
      });
      await ready(renamed);
      expect(probeOf(renamed.probes, "instance")).toBeDefined();

      const several = mount({
        interaction: interactionOf('module="two" custom-interaction-type-identifier="urn:test:c"'),
        configuration: { primary: resolution({ two: "modules/two" }) },
      });
      await waitFor(() => expect(several.events).toEqual([{ type: "failed", reason: "register" }]));
      const chosen = mount({
        interaction: interactionOf('module="two" custom-interaction-type-identifier="urn:test:b"'),
        configuration: { primary: resolution({ two: "modules/two" }) },
      });
      await ready(chosen);
      expect(probeOf(chosen.probes, "made")).toMatchObject({ typeIdentifier: "urn:test:b" });
    });
  });

  describe("the configuration", () => {
    it("gives the interaction its properties, variables, markup, status and language", async () => {
      const result = mount({
        interaction: interactionOf(
          `${SIMPLE} class="qti-orientation-horizontal" data-label-min="Very poorly" data-__proto__="data"`,
        ),
        language: "id",
        status: "review",
        templateVariables: new Map([["X", { value: single("integer", 3), declaration: INTEGER }]]),
        contextVariables: new Map([
          [
            "LIMIT",
            {
              value: container("multiple", "float", [1.5, 2.5]),
              declaration: { cardinality: "multiple", baseType: "float" },
            },
          ],
        ]),
        response: { value: single("integer", 2), declaration: INTEGER },
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
        title: TITLE,
      });
      expect(JSON.stringify(instance?.configuration)).toContain('"__proto__":"data"');
      expect(instance?.markup).toContain('<button id="press">Press</button>');
    });

    it("creates a new interaction without state, and the NULL of its response variable", async () => {
      const result = mount();
      await ready(result);
      expect(probeOf(result.probes, "instance")).toMatchObject({
        state: null,
        configuration: { status: "interacting", boundTo: { base: null } },
      });
    });

    it("loads player.css, then the stylesheets of the item, in the frame", async () => {
      const result = mount();
      await ready(result);
      // player.css sets the text of the root to #1a1a1a; the stylesheet of the item, which comes after it, colors the button.
      expect(probeOf(result.probes, "instance")).toMatchObject({
        rootColor: "rgb(26, 26, 26)",
        color: "rgb(10, 20, 30)",
      });
    });

    it("takes every status that the item session has", async () => {
      for (const status of ["interacting", "suspended", "closed", "solution", "review"] as const) {
        const result = mount({ status });
        await ready(result);
        expect(probeOf(result.probes, "instance")).toMatchObject({ configuration: { status } });
      }
    });
  });

  describe("the responses", () => {
    it("turns qti-interaction-changed into the value of the response variable, with the state", async () => {
      const result = mount();
      await ready(result);
      await commands.clickInFrame(TITLE, "#press");
      await waitFor(() =>
        expect(eventOf(result.events, "changed")).toEqual({
          type: "changed",
          response: single("integer", 1),
          state: '{"count":1}',
          valid: true,
        }),
      );
    });

    it("restores the interaction from the state that getState gave", async () => {
      const result = mount({
        state: JSON.stringify({ count: 2 }),
        response: { value: single("integer", 2), declaration: INTEGER },
      });
      await ready(result);
      await commands.clickInFrame(TITLE, "#press");
      await waitFor(() => expect(eventOf(result.events, "changed")).toMatchObject({ response: single("integer", 3) }));
    });

    it("reads the bytes of a file value before the interaction starts, and writes them inline", async () => {
      const { files } = memoryFiles(new Map([["stored-1", new TextEncoder().encode("pleasure.")]]));
      const result = mount(
        filesPci(files, single("file", { reference: "stored-1", mimeType: "text/plain", fileName: "helloworld.txt" })),
      );
      await ready(result);
      // The data is the base64 of "pleasure." that the best practices guide shows.
      expect(probeOf(result.probes, "instance")).toMatchObject({
        boundTo: { base: { file: { data: "cGxlYXN1cmUu", mime: "text/plain", name: "helloworld.txt" } } },
      });
    });

    it("stores the file of a response through the host and delivers its reference", async () => {
      const { files, uploads } = memoryFiles();
      const result = mount(filesPci(files));
      await ready(result);
      await commands.clickInFrame(TITLE, "#give");
      await waitFor(() => expect(eventsOf(result, "changed")).toHaveLength(1));
      expect(eventOf(result.events, "changed")).toMatchObject({
        response: single("file", { reference: "uploaded-1", mimeType: "text/plain", fileName: "f1.txt" }),
      });
      expect(uploads).toEqual([
        { bytes: new TextEncoder().encode("file 1"), mimeType: "text/plain", fileName: "f1.txt" },
      ]);
    });

    it("stores a file that the interaction gives again only once", async () => {
      const { files, uploads } = memoryFiles();
      const result = mount(filesPci(files));
      await ready(result);
      await commands.clickInFrame(TITLE, "#same");
      await commands.clickInFrame(TITLE, "#same");
      await waitFor(() => expect(eventsOf(result, "changed")).toHaveLength(2));
      expect(uploads).toHaveLength(1);
      expect(eventsOf(result, "changed").map((event) => event.response)).toEqual([
        single("file", { reference: "uploaded-1", mimeType: "text/plain", fileName: "same.txt" }),
        single("file", { reference: "uploaded-1", mimeType: "text/plain", fileName: "same.txt" }),
      ]);
    });

    it("delivers the events in the order they were sent, although storing a file takes time", async () => {
      const { files, uploads } = memoryFiles();
      const slow: typeof files = {
        read: files.read,
        upload: async (blob, mimeType, fileName) => {
          if (uploads.length === 0) await new Promise((done) => setTimeout(done, 300));
          return files.upload(blob, mimeType, fileName);
        },
      };
      const result = mount(filesPci(slow));
      await ready(result);
      await commands.clickInFrame(TITLE, "#give");
      await commands.clickInFrame(TITLE, "#give");
      await waitFor(() => expect(eventsOf(result, "changed")).toHaveLength(2));
      const states = eventsOf(result, "changed").map((event) => event.state);
      expect(states).toEqual(['{"given":1}', '{"given":2}']);
    });

    it("drops a response that is not the JSON of a value of the declaration, and goes on", async () => {
      const result = mount(filesPci(memoryFiles().files));
      await ready(result);
      await commands.clickInFrame(TITLE, "#bad");
      await commands.clickInFrame(TITLE, "#give");
      await waitFor(() => expect(eventsOf(result, "changed")).toHaveLength(1));
      expect(eventOf(result.events, "changed")).toMatchObject({ state: '{"given":1}' });
    });

    it("reports that the interaction cannot start when the host cannot read a file", async () => {
      const report = vi.spyOn(window, "reportError").mockImplementation(() => undefined);
      const result = mount(
        filesPci(
          { read: () => Promise.reject(new Error("The storage is down.")), upload: memoryFiles().files.upload },
          single("file", { reference: "lost", mimeType: "text/plain" }),
        ),
      );
      await waitFor(() => expect(result.events).toEqual([{ type: "failed", reason: "files" }]));
      expect(report).toHaveBeenCalledWith(new Error("The storage is down."));
      report.mockRestore();
    });
  });

  describe("the events", () => {
    it("tells that the interaction is ready, with its state", async () => {
      const result = mount({ state: JSON.stringify({ count: 4 }) });
      await ready(result);
      expect(eventOf(result.events, "ready")).toEqual({ type: "ready", state: '{"count":4}' });
    });

    it("passes ondone with the status that the interaction asks for, and NULL for no response", async () => {
      const result = mount();
      await ready(result);
      await commands.clickInFrame(TITLE, "#done");
      await waitFor(() =>
        expect(eventOf(result.events, "done")).toEqual({
          type: "done",
          response: null,
          state: '{"count":0}',
          status: "solution",
        }),
      );
    });

    it("asks the validity methods of the interaction", async () => {
      const result = mount();
      await ready(result);
      expect(await result.frame.checkValidity()).toBe(false);
      await commands.clickInFrame(TITLE, "#press");
      await waitFor(async () => expect(await result.frame.checkValidity()).toBe(true));
      expect(await result.frame.reportValidity()).toBe(true);
      expect(probeOf(result.probes, "reportValidity")).toBeDefined();
      expect(await result.frame.getCustomValidity()).toBe("");
      await result.frame.setCustomValidity("Press once more.");
      expect(await result.frame.getCustomValidity()).toBe("Press once more.");
    });

    it("refuses a custom validity message that is not a string", async () => {
      const result = mount();
      await expect(result.frame.setCustomValidity(JSON.parse("5"))).rejects.toThrow(
        "The custom validity message must be a string, found 5.",
      );
    });

    it("gives no verdict when the interaction is not running", async () => {
      const result = mount({ configuration: FAILING });
      expect(await result.frame.checkValidity()).toBeUndefined();
      await waitFor(() => expect(eventOf(result.events, "failed")).toBeDefined());
      expect(await result.frame.getCustomValidity()).toBeUndefined();
    });

    it("hands over the response and the state, then calls oncompleted, when the frame goes", async () => {
      const result = mount({
        state: JSON.stringify({ count: 2 }),
        response: { value: single("integer", 2), declaration: INTEGER },
      });
      await ready(result);
      await result.frame.destroy();
      expect(eventOf(result.events, "completed")).toEqual({
        type: "completed",
        response: single("integer", 2),
        state: '{"count":2}',
      });
      const completed = probeOf(result.probes, "oncompleted");
      expect(completed?.calls).toEqual(["getState", "getResponse", "getState", "oncompleted"]);
      expect(result.container.querySelector("iframe")).toBeNull();
    });

    it("removes a frame that never started, and does it once", async () => {
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
    it("runs no script of the markup", async () => {
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
    it("sets the height of the frame to the height of its content", async () => {
      const result = mount({ markup: '<div style="height: 300px"></div>' });
      await waitFor(() => {
        const height = result.frame.element.getBoundingClientRect().height;
        expect(height).toBeGreaterThanOrEqual(300);
        expect(height).toBeLessThan(360);
      });
    });

    it("keeps the height between the least and the greatest", async () => {
      const small = mount({ markup: "" });
      await ready(small);
      expect(small.frame.element.getBoundingClientRect().height).toBe(MIN_PCI_HEIGHT);
      const tall = mount({ markup: '<div style="height: 6000px"></div>' });
      await waitFor(() => expect(tall.frame.element.getBoundingClientRect().height).toBe(MAX_PCI_HEIGHT));
    });
  });

  describe("the presentation", () => {
    const highContrast = presentationOf([onSupport("high-contrast")]);

    /** The attributes of the player's look that the frame has. */
    const look = ({ attributes }: FrameTheme) =>
      Object.fromEntries(Object.entries(attributes).filter(([name]) => name.startsWith("data-ak-")));

    it("starts with the look that the supports ask for, set on the html of the frame before anything is drawn", async () => {
      const mounted = mount({ presentation: highContrast });
      await ready(mounted);
      const theme = await commands.frameTheme(TITLE);
      expect(theme.attributes["data-ak-contrast"]).toBe("high");
      // docs/player/styling.md: high contrast is black on white.
      expect(theme.properties).toEqual({ "--ak-fg": "#000000", "--ak-bg": "#ffffff" });
      expect(theme.color).toBe("rgb(0, 0, 0)");
    });

    it("changes the look of a running interaction when a setting changes", async () => {
      const mounted = mount({ presentation: highContrast });
      await ready(mounted);
      mounted.frame.setPresentation(presentationOf([onSupport("invert-display-polarity"), onSupport("magnification")]));
      await waitFor(async () =>
        expect((await commands.frameTheme(TITLE)).attributes).toEqual({
          lang: "en",
          "data-ak-polarity": "inverted",
          style: "--ak-text-zoom: 2;",
        }),
      );
      const theme = await commands.frameTheme(TITLE);
      // docs/player/styling.md: inverted polarity is #f2f2f2 on #121212, and 200 percent of the 16 pixels of the base size.
      expect(theme.properties).toEqual({ "--ak-fg": "#f2f2f2", "--ak-bg": "#121212" });
      expect(theme.color).toBe("rgb(242, 242, 242)");
      expect(theme.fontSize).toBe("32px");
      mounted.frame.setPresentation(presentationOf([]));
      await waitFor(async () => expect(look(await commands.frameTheme(TITLE))).toEqual({}));
      // The defaults of the stylesheet are back.
      expect((await commands.frameTheme(TITLE)).properties).toEqual({
        "--ak-fg": "#1a1a1a",
        "--ak-bg": "#ffffff",
      });
    });

    it("keeps the look it was given before the frame started", async () => {
      const mounted = mount();
      mounted.frame.setPresentation(highContrast);
      await ready(mounted);
      expect((await commands.frameTheme(TITLE)).attributes["data-ak-contrast"]).toBe("high");
    });

    it("does not change the interaction, which is told nothing of the look", async () => {
      const mounted = mount({ presentation: highContrast });
      await ready(mounted);
      mounted.frame.setPresentation(presentationOf([]));
      await waitFor(async () => expect(look(await commands.frameTheme(TITLE))).toEqual({}));
      expect(mounted.events.map(({ type }) => type)).toEqual(["ready"]);
    });

    it("rejects a presentation that is not one, and takes one after the frame is gone", async () => {
      const mounted = mount();
      expect(() => mounted.frame.setPresentation(JSON.parse('{"attributes": {}}'))).toThrow(
        new DataError("The presentation property attributes must be a Map, found an object."),
      );
      expect(() => mount({ presentation: JSON.parse("null") })).toThrow(
        new DataError("The option presentation must be an object with the maps attributes and properties, found null."),
      );
      await mounted.frame.destroy();
      expect(() => mounted.frame.setPresentation(highContrast)).not.toThrow();
    });
  });

  describe("options", () => {
    it("refuses a parent that is not an element, options that are not valid, and an interaction with no module", () => {
      const parent = document.createElement("div");
      const options: PciFrameOptions = {
        staticUrl: `${asset}/static/`,
        messages: EN_MESSAGES,
        language: "en",
        interaction: interactionOf(SIMPLE),
        configuration: { primary: resolution({ simple: "modules/simple" }) },
        assets,
        prompt: null,
        markup: "",
        stylesheets: [],
        status: "interacting",
        response: { value: null, declaration: INTEGER },
        files: memoryFiles().files,
        onEvent: () => undefined,
      };
      expect(() => mountPciFrame(JSON.parse("null"), options)).toThrow("The parent must be an element, found null.");
      expect(() => mountPciFrame(parent, JSON.parse('{"staticUrl":"x"}'))).toThrow(/staticUrl/u);
      expect(() => mountPciFrame(parent, { ...options, staticUrl: "https://cdn.example/static" })).toThrow(
        'The option staticUrl must end in "/"',
      );
      expect(() => mountPciFrame(parent, { ...options, configuration: {} })).toThrow(
        'The module "simple" has no location',
      );
      expect(parent.childElementCount).toBe(0);
    });
  });
});

describe("the frame", () => {
  describe("the policy", () => {
    it("reaches no network, no parent, no storage and no other window, and learns no address of the page", async () => {
      const result = mount({
        interaction: interactionOf(
          `module="hostile" custom-interaction-type-identifier="urn:test:hostile" data-evil="${stranger}"`,
        ),
        configuration: { primary: resolution({ hostile: "modules/hostile" }) },
      });
      const location = window.location.href;
      await waitFor(() => expect(probeOf(result.probes, "hostile")).toBeDefined());
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
        referrer: "blocked",
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

    it("drops forged messages and bounds a forged height", async () => {
      const result = mount({
        interaction: interactionOf('module="forger" custom-interaction-type-identifier="urn:test:forger"'),
        configuration: { primary: resolution({ forger: "modules/forger" }) },
      });
      await waitFor(() => expect(result.frame.element.style.height).toBe(`${MAX_PCI_HEIGHT}px`));
      expect(result.events).toEqual([{ type: "ready", state: "{}" }]);
    });

    it("ignores a message that does not come from the frame", async () => {
      const result = mount();
      await ready(result);
      window.postMessage({ type: "changed", response: { base: { integer: 9 } }, state: "{}" }, "*");
      window.postMessage({ type: "height", height: 3000 }, "*");
      await new Promise((done) => setTimeout(done, 200));
      expect(eventOf(result.events, "changed")).toBeUndefined();
      expect(result.frame.element.style.height).not.toBe("3000px");
    });

    it("does not start the interaction where the browser sets no policy", async () => {
      const result = mount({ staticUrl: `${asset}/unrestricted/` });
      await waitFor(() => expect(result.events).toEqual([{ type: "failed", reason: "csp" }]));
      expect(await hits(asset)).not.toContain("/g/modules/simple.js");
    });
  });

  describe("the name and the focus", () => {
    it("names the frame from the prompt of the interaction, else by a message", () => {
      const prompt = mount({ prompt: "  Press   the\n button. " });
      const none = mount({ prompt: null });
      const blank = mount({ prompt: " \n " });
      const indonesian = mount({ prompt: null, messages: ID_MESSAGES });
      expect(prompt.frame.element.title).toBe(TITLE);
      expect(none.frame.element.title).toBe("Interactive question");
      expect(blank.frame.element.title).toBe("Interactive question");
      expect(indonesian.frame.element.title).toBe("Soal interaktif");
    });

    it("has no axe violation on the frame element, and none inside the frame", async () => {
      const axe = (await import("axe-core")).default;
      const result = mount();
      await ready(result);
      const outside = await axe.run(result.container, { runOnly: { type: "tag", values: WCAG_TAGS } });
      expect(outside.violations).toEqual([]);
      expect(await commands.axeInFrame(TITLE, WCAG_TAGS)).toEqual([]);
    });

    it("exposes the controls of the frame in the accessibility tree, below the frame", async () => {
      const result = mount();
      await ready(result);
      await waitFor(async () => {
        const tree = await commands.ariaSnapshot();
        expect(tree).toMatch(/- iframe[^\n]*:\n(?:.*\n)*?\s+- button "Press"/u);
        expect(tree).toMatch(/- button "Done"/u);
      });
    });

    it("lets the focus enter the frame and leave it, forward and back", async () => {
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
      await waitFor(() => expect(visited(result)).toEqual(["first", "second"]));
      // Going back, the frame ends at its first field; Firefox does not report a second visit to the second.
      await tabTo(before, true);
      await waitFor(() => expect(visited(result).at(-1)).toBe("first"));
      before.remove();
      after.remove();
    });
  });
});
