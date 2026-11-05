// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages are snake_case.

import type { ItemKey } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { afterEach, describe, expect, inject, it } from "vitest";
import { createRemoteSession, type Transport } from "../src/client/index.js";
import type { LtiLogin } from "../src/player/index.js";
import { mountDelivery } from "../src/player/index.js";
import { mountLtiFrame } from "../src/player/lti-frame/index.js";
import type { LtiFrame } from "../src/protocol/index.js";
import { PLAYER_CSS } from "./css-fixture.js";
import { examHost } from "./exam-fixture.js";
import { NO_RECORDING } from "./files-fixture.js";
import type { Hit } from "./fixtures/lti-server.js";
import { ltiExamFiles } from "./lti-exam-fixture.js";
import { axeViolations } from "./renderer-fixture.js";
import { waitFor } from "./wait.js";

const { platform, tool, other } = inject("lti");
const { asset } = inject("fixtures");
const refused = [location.origin, asset];
const CANDIDATE = { session: "exam-1", principal: "alice" };
const DRAW: ItemKey = { ref: "draw", instance: 1 };
const ESSAY: ItemKey = { ref: "essay", instance: 1 };

const parents: HTMLElement[] = [];
afterEach(() => {
  for (const parent of parents.splice(0)) parent.remove();
});

/** The hits of a fixture server. */
async function hitsOf(origin: string): Promise<Hit[]> {
  return (await fetch(`${origin}/__hits`, { cache: "no-store" })).json();
}

/** What a tool with the token reported, in the order the server recorded it. */
async function reported(origin: string, token: string): Promise<string[]> {
  const prefix = `/report/${token}/`;
  return (await hitsOf(origin)).flatMap(({ path }) => (path.startsWith(prefix) ? [path.slice(prefix.length)] : []));
}

/** Waits until the tool has reported every step. */
function expectReports(origin: string, token: string, steps: readonly string[]): Promise<void> {
  return waitFor(async () => expect(await reported(origin, token)).toEqual(expect.arrayContaining([...steps])));
}

const storagePageUrl = (delay = 0): string =>
  `${platform}/storage?player=${encodeURIComponent(location.origin)}&delay=${delay}`;

function toolUrl(origin: string, scenario: string, token: string, extra = ""): string {
  const query = new URLSearchParams({ platform, frame: "lti-storage", scenario, token, player: location.origin });
  return `${origin}/tool.html?${query}${extra}`;
}

const frameFor = (url: string, allow?: string): LtiFrame => ({
  url,
  storageUrl: storagePageUrl(),
  ...(allow === undefined ? {} : { allow }),
});

/** Mounts the frames of a tool in a parent that the test removes. */
function mount(launch: LtiFrame) {
  const parent = document.createElement("div");
  document.body.append(parent);
  parents.push(parent);
  const mounted = mountLtiFrame(parent, launch, {
    title: "Drawing tool",
    storageTitle: "Storage for the tool",
    refused,
  });
  const toolFrame = parent.querySelector<HTMLIFrameElement>("iframe[name='lti-tool']");
  const storageFrame = parent.querySelector<HTMLIFrameElement>("iframe[name='lti-storage']");
  if (toolFrame === null || storageFrame === null) throw new Error("The parent has no frames.");
  return { parent, mounted, toolFrame, storageFrame };
}

const token = (): string => crypto.randomUUID();

describe("the storage that a tool uses for its login", () => {
  it("keeps and returns the values of a tool, answers from the origin of the platform, and reports each error with the code of the specification", async () => {
    const id = token();
    mount(frameFor(toolUrl(tool, "storage", id)));
    await expectReports(tool, id, [
      "put-ok-v1",
      "get-ok-v1",
      "missing-error-key_not_found",
      "keyless-error-bad_request",
      "unsupported-error-unsupported_subject",
      "big-error-storage_exhaustion",
      "clear-ok-empty",
      "cleared-error-key_not_found",
      "done",
    ]);
    expect(await reported(tool, id)).not.toContain("wrong-origin");
  });

  it("keeps at most 500 keys for an origin, the least a platform must offer", async () => {
    const id = token();
    mount(frameFor(toolUrl(tool, "keys", id)));
    await expectReports(tool, id, ["key-501-error-storage_exhaustion", "done"]);
  });

  it("keeps the values by the origin of the message: another tool in the same frame does not see them", async () => {
    const first = token();
    const { toolFrame } = mount(frameFor(toolUrl(tool, "write", first)));
    await expectReports(tool, first, ["write-ok-mine", "done"]);
    const second = token();
    toolFrame.src = toolUrl(other, "read", second);
    await expectReports(other, second, ["read-error-key_not_found", "done"]);
    const third = token();
    toolFrame.src = toolUrl(tool, "read", third);
    await expectReports(tool, third, ["read-ok-mine", "done"]);
  });

  it("answers only the frame of the tool: a message from the player's page gets no answer", async () => {
    const id = token();
    const { storageFrame } = mount(frameFor(toolUrl(tool, "storage", id)));
    await expectReports(tool, id, ["done"]);
    const answers: unknown[] = [];
    const listener = (event: MessageEvent): void => void answers.push(event.data);
    window.addEventListener("message", listener);
    storageFrame.contentWindow?.postMessage(
      { subject: "lti.put_data", message_id: "from-the-page", key: "k", value: "v" },
      platform,
    );
    await new Promise((done) => setTimeout(done, 400));
    window.removeEventListener("message", listener);
    expect(answers).toEqual([]);
  });

  it("answers the capabilities request of the tool itself, and names the frame of the storage for the two storage messages", async () => {
    const id = token();
    mount(frameFor(toolUrl(tool, "capabilities", id)));
    await expectReports(tool, id, [
      "capabilities-lti.capabilities.response-lti.capabilities@parent,lti.put_data@lti-storage,lti.get_data@lti-storage",
    ]);
  });
});

describe("the frames of a tool", () => {
  it("puts the tool in a sandboxed frame with the title of the link and the allow list of the registration, and the storage in a hidden frame", () => {
    const { toolFrame, storageFrame } = mount(frameFor(toolUrl(tool, "sandbox", token()), "microphone; camera 'self'"));
    expect(toolFrame.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-same-origin");
    expect(toolFrame.getAttribute("allow")).toBe("microphone; camera 'self'");
    expect(toolFrame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(toolFrame.title).toBe("Drawing tool");
    expect(storageFrame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(storageFrame.hidden).toBe(true);
    expect(storageFrame.title).toBe("Storage for the tool");
    expect(storageFrame.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("sets no allow list when the registration has none", () => {
    const { toolFrame } = mount(frameFor(toolUrl(tool, "sandbox", token())));
    expect(toolFrame.hasAttribute("allow")).toBe(false);
  });

  it("keeps the origin of the tool in its sandbox, so that the tool has its own storage", async () => {
    const id = token();
    mount(frameFor(toolUrl(tool, "sandbox", id)));
    await expectReports(tool, id, ["origin-kept", "done"]);
  });

  it("starts the tool when the storage page has loaded, so that the first message of its login finds the page listening", async () => {
    const id = token();
    mount({ url: toolUrl(tool, "storage", id), storageUrl: storagePageUrl(500) });
    await expectReports(tool, id, ["put-ok-v1", "done"]);
    const storage = (await hitsOf(platform)).find(({ path }) => path === "/storage");
    const started = (await hitsOf(tool)).find(({ path }) => path === "/tool.html");
    expect(storage?.at).toBeLessThanOrEqual(started?.at ?? 0);
  });

  it("refuses a tool or a storage page on the origin of the player or of the assets, and a frame that is not one", () => {
    const parent = document.createElement("div");
    parents.push(parent);
    const options = { title: "Tool", storageTitle: "Storage", refused };
    const cases: readonly [LtiFrame, string][] = [
      [
        { url: `${location.origin}/login`, storageUrl: storagePageUrl() },
        `The tool must not be served from "${location.origin}", which is the origin of the player or of the assets.`,
      ],
      [
        { url: `${asset}/login`, storageUrl: storagePageUrl() },
        `The tool must not be served from "${asset}", which is the origin of the player or of the assets.`,
      ],
      [
        { url: `${tool}/login`, storageUrl: `${asset}/storage` },
        `The storage page must not be served from "${asset}", which is the origin of the player or of the assets.`,
      ],
    ];
    for (const [launch, message] of cases) {
      expect(() => mountLtiFrame(parent, launch, options), message).toThrow(new DataError(message));
    }
    expect(() => mountLtiFrame(parent, { url: "javascript:alert(1)", storageUrl: storagePageUrl() }, options)).toThrow(
      DataError,
    );
    expect(() => mountLtiFrame(parent, JSON.parse("null"), options)).toThrow(
      new DataError("The frame of an LTI item must be an object, found null."),
    );
    expect(parent.children).toHaveLength(0);
  });

  it("answers the capabilities request of the window of the tool alone, and never from an opaque origin", () => {
    const { toolFrame } = mount(frameFor(toolUrl(tool, "sandbox", token())));
    // A message port stands in for the window of the tool, so that what the player posts to it can be seen.
    const { port1: standIn } = new MessageChannel();
    const posted: unknown[][] = [];
    standIn.postMessage = (...call: unknown[]): void => void posted.push(call);
    Object.defineProperty(toolFrame, "contentWindow", { value: standIn });
    const request = { subject: "lti.capabilities", message_id: "7" };
    const send = (init: MessageEventInit): boolean =>
      window.dispatchEvent(new MessageEvent("message", { data: request, ...init }));
    send({ source: window, origin: tool });
    expect(posted, "a message from another window").toEqual([]);
    send({ source: standIn, origin: "null" });
    expect(posted, "a message from an opaque origin").toEqual([]);
    send({ source: standIn, origin: tool });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.[1]).toBe(tool);
    expect(posted[0]?.[0]).toMatchObject({ subject: "lti.capabilities.response", message_id: "7" });
  });

  it("removes both frames when destroyed", () => {
    const { parent, mounted } = mount(frameFor(toolUrl(tool, "sandbox", token())));
    expect(parent.querySelectorAll("iframe")).toHaveLength(2);
    mounted.destroy();
    expect(parent.querySelectorAll("iframe")).toHaveLength(0);
  });
});

describe("mountDelivery with an item that is a link to a tool", () => {
  const players: HTMLElement[] = [];
  afterEach(() => {
    for (const host of players.splice(0)) host.remove();
  });

  /** Mounts the player on an exam session whose second item is the link, with the hook of the host. */
  async function player(ltiLogin?: LtiLogin) {
    const setup = await examHost({}, ltiExamFiles({ maximum: 20 }), asset);
    const transport: Transport = async (envelope) =>
      JSON.parse(JSON.stringify(await setup.host.handle(CANDIDATE, JSON.parse(JSON.stringify(envelope)))));
    const started = JSON.parse(JSON.stringify(await setup.host.start(CANDIDATE, { seed: 1 })));
    const client = createRemoteSession(transport, started, { clock: setup.clock });
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(PLAYER_CSS);
    const host = document.createElement("div");
    document.body.append(host);
    players.push(host);
    const mounted = mountDelivery(host, {
      client,
      files: {
        upload: async () => ({ reference: "f", mimeType: "image/png" }),
        read: async () => new Uint8Array(),
        url: () => "",
        ...NO_RECORDING,
      },
      staticUrl: `${asset}/static/`,
      stylesheet,
      fetch: async () => ({ ok: false, status: 404, text: async () => "" }),
      ...(ltiLogin === undefined ? {} : { ltiLogin }),
    });
    const ui = host.shadowRoot as ShadowRoot;
    const slot = ui.querySelector<HTMLElement>(".ak-lti") as HTMLElement;
    return { ...setup, client, mounted, ui, slot, host };
  }

  const frames = (host: HTMLElement): string[] =>
    [...host.querySelectorAll(":scope > iframe")].map((each) => (each as HTMLIFrameElement).name);

  it("shows the tool of the open item in its frame, once, and takes it away when the candidate leaves the item", async () => {
    const calls: ItemKey[] = [];
    const { client, host } = await player(async (item) => {
      calls.push(item);
      return frameFor(toolUrl(tool, "sandbox", token()), "microphone");
    });
    expect(frames(host)).toEqual([]);
    await client.dispatch({ type: "move", to: DRAW });
    await waitFor(() => expect(frames(host)).toEqual(["lti-storage", "lti-tool"]));
    const frame = host.querySelector("iframe[name='lti-tool']");
    expect(frame?.getAttribute("title")).toBe("Drawing tool");
    expect(frame?.getAttribute("allow")).toBe("microphone");
    // A new view of the same item leaves the tool where it is.
    await client.dispatch({ type: "comment", item: DRAW, text: "a note" });
    expect(host.querySelector("iframe[name='lti-tool']")).toBe(frame);
    expect(calls).toEqual([DRAW]);
    await client.dispatch({ type: "move", to: ESSAY });
    expect(frames(host)).toEqual([]);
    await client.dispatch({ type: "move", to: DRAW });
    await waitFor(() => expect(frames(host)).toEqual(["lti-storage", "lti-tool"]));
    expect(calls).toEqual([DRAW, DRAW]);
  });

  it("launches the tool with the storage of the platform and keeps the player free of axe violations", async () => {
    const id = token();
    const { client, host } = await player(async () => frameFor(toolUrl(tool, "storage", id)));
    await client.dispatch({ type: "move", to: DRAW });
    await expectReports(tool, id, ["put-ok-v1", "get-ok-v1", "done"]);
    expect(await axeViolations(host)).toEqual([]);
    expect(host.querySelector("iframe[name='lti-tool']")?.getAttribute("title")).toBe("Drawing tool");
  });

  it("says that the tool is not available when the host gave no hook, and when the hook fails or answers what is not a frame", async () => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent): void => {
      event.preventDefault();
      errors.push(event.error);
    };
    window.addEventListener("error", onError);
    try {
      const none = await player();
      await none.client.dispatch({ type: "move", to: DRAW });
      await waitFor(() => expect(none.slot.textContent).toBe("The tool for this question could not be started."));
      expect(none.slot.querySelector("[role='alert']")).not.toBeNull();
      expect(frames(none.host)).toEqual([]);

      const failing = await player(async () => {
        throw new Error("The route failed.");
      });
      await failing.client.dispatch({ type: "move", to: DRAW });
      await waitFor(() => expect(failing.slot.textContent).toBe("The tool for this question could not be started."));

      const wrong = await player(async () => ({ url: `${location.origin}/login`, storageUrl: storagePageUrl() }));
      await wrong.client.dispatch({ type: "move", to: DRAW });
      await waitFor(() => expect(wrong.slot.textContent).toBe("The tool for this question could not be started."));
      expect(frames(wrong.host)).toEqual([]);
      expect(errors.map((error) => (error instanceof Error ? error.name : String(error)))).toEqual([
        "Error",
        "DataError",
      ]);
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("shows a note in place of the tool once the item is closed", async () => {
    const { client, slot, host } = await player(async () => frameFor(toolUrl(tool, "sandbox", token())));
    await client.dispatch({ type: "move", to: DRAW });
    await waitFor(() => expect(frames(host)).toEqual(["lti-storage", "lti-tool"]));
    await client.dispatch({ type: "submit", item: DRAW });
    await waitFor(() => expect(slot.textContent).toBe("The tool for this question is no longer open."));
    expect(frames(host)).toEqual([]);
  });

  it("ignores a tool that arrives after the candidate has left the item", async () => {
    let release: (frame: LtiFrame) => void = () => undefined;
    const slow = new Promise<LtiFrame>((resolve) => {
      release = resolve;
    });
    const { client, host } = await player(() => slow);
    await client.dispatch({ type: "move", to: DRAW });
    await client.dispatch({ type: "move", to: ESSAY });
    release(frameFor(toolUrl(tool, "sandbox", token())));
    await new Promise((done) => setTimeout(done, 200));
    expect(frames(host)).toEqual([]);
  });

  it("aborts the signal of a login that waits when the candidate leaves the item, and when the player is destroyed", async () => {
    const signals: AbortSignal[] = [];
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent): void => {
      event.preventDefault();
      errors.push(event.error);
    };
    window.addEventListener("error", onError);
    try {
      const { client, mounted, slot, host } = await player(
        (_item, options) =>
          new Promise<LtiFrame>((_resolve, reject) => {
            const signal = options?.signal ?? new AbortController().signal;
            signals.push(signal);
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      );
      await client.dispatch({ type: "move", to: DRAW });
      await waitFor(() => expect(signals).toHaveLength(1));
      expect(signals[0]?.aborted).toBe(false);
      await client.dispatch({ type: "move", to: ESSAY });
      await waitFor(() => expect(signals[0]?.aborted).toBe(true));
      // The abort is the player's own doing: it shows no notice and reports no error.
      expect(slot.textContent).toBe("");
      expect(frames(host)).toEqual([]);
      await client.dispatch({ type: "move", to: DRAW });
      await waitFor(() => expect(signals).toHaveLength(2));
      mounted.destroy();
      expect(signals[1]?.aborted).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener("error", onError);
    }
  });
});
