import { ASI_NAMESPACE } from "@luthfanwakan/olah/asi";
import type { CandidateAction } from "@luthfanwakan/olah/delivery";
import { readPnp } from "@luthfanwakan/olah/pnp";
import { type FileValue, single } from "@luthfanwakan/olah/values";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { createLocalSession, createRemoteSession, type Transport } from "../src/client/index.js";
import { DataError, ID_MESSAGES } from "../src/index.js";
import type { SpeechRequest, StylesheetFetch } from "../src/player/index.js";
import { mountDelivery } from "../src/player/index.js";
import type { SessionClient } from "../src/protocol/index.js";
import { PLAYER_CSS } from "./css-fixture.js";
import { examDefinition, examFiles, examHost, packageOf } from "./exam-fixture.js";
import { picture } from "./graphic-fixture.js";
import { axeViolations } from "./renderer-fixture.js";

const ALICE = { session: "exam-1", principal: "alice" };
const SECOND = 1000;
const Q1 = { ref: "q1", instance: 1 };
const PRACTICE_PATH = "/g/practice/";

const realSetTimeout = globalThis.setTimeout;
/** Waits on the real clock, for the work of the page and of the host while timers are fake. */
const real = (milliseconds: number): Promise<void> => new Promise((resolve) => realSetTimeout(resolve, milliseconds));

const player = new CSSStyleSheet();
player.replaceSync(PLAYER_CSS);

/** A session client that is another in all but `dispatch`: the view and the documents stay the other's, live. */
const withDispatch = (client: SessionClient, dispatch: SessionClient["dispatch"]): SessionClient =>
  Object.create(client, { dispatch: { value: dispatch } });

const hosts: HTMLElement[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) host.remove();
});

/** What a test mounts: the page element, the chrome in its shadow root, and the means to drive and read the session. */
async function shell(
  options: {
    readonly files?: Readonly<Record<string, string | Uint8Array>>;
    readonly language?: string;
    readonly practice?: boolean;
    readonly chrome?: boolean;
    readonly wrap?: (client: SessionClient) => SessionClient;
    /** The PNP of the candidate, as a document. */
    readonly profile?: string;
    readonly upload?: (bytes: Blob, mimeType: string) => Promise<FileValue>;
    readonly url?: (file: FileValue) => string;
    readonly voice?: { speak(request: SpeechRequest): Promise<void>; stop(): void };
  } = {},
) {
  const origin = inject("fixtures").asset;
  const setup = await examHost({}, options.files, origin);
  const definition = examDefinition(packageOf(options.files ?? examFiles()));
  const pnp = options.profile === undefined ? undefined : readPnp(options.profile);
  if (pnp !== undefined && !("supports" in pnp)) throw new Error("The fixture profile must be one profile.");
  const profile = pnp === undefined ? {} : { pnp };
  let client: SessionClient;
  let started: unknown;
  if (options.practice === true) {
    const saved = new Map<string, string>();
    client = await createLocalSession({
      definition,
      store: {
        load: async (session) => saved.get(session),
        save: async (session, state) => void saved.set(session, state),
      },
      session: "practice-1",
      seed: 1,
      start: profile,
      assets: (path) => `${origin}${PRACTICE_PATH}${path}`,
      clock: setup.clock,
    });
  } else {
    const transport: Transport = async (envelope) =>
      JSON.parse(JSON.stringify(await setup.host.handle(ALICE, JSON.parse(JSON.stringify(envelope)))));
    started = JSON.parse(JSON.stringify(await setup.host.start(ALICE, { seed: 1, ...profile })));
    client = createRemoteSession(transport, started as never, { clock: setup.clock });
  }
  const shown = options.wrap === undefined ? client : options.wrap(client);
  const fetcher: StylesheetFetch = async (url) => {
    const { pathname } = new URL(url);
    // Practice reads the files of the package from the page's own server; an exam reads them from the gate.
    const own = /^\/g\/(?:practice|pci)\//u.exec(pathname)?.[0];
    const bytes = own === undefined ? undefined : setup.pkg.file(pathname.slice(own.length));
    const response =
      own !== undefined
        ? { status: bytes === undefined ? 404 : 200, body: bytes }
        : await setup.gate.serve({ path: pathname }, setup.clock.now());
    return {
      ok: response.status === 200,
      status: response.status,
      text: async () => new TextDecoder().decode(response.body),
    };
  };
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const mounted = mountDelivery(host, {
    client: shown,
    files: {
      upload: options.upload ?? (async () => ({ reference: "f", mimeType: "image/png" })),
      read: async () => new Uint8Array(),
      url: options.url ?? (() => ""),
    },
    staticUrl: `${origin}/static/`,
    stylesheet: player,
    fetch: fetcher,
    ...(options.voice === undefined ? {} : { hooks: { voice: options.voice } }),
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.chrome === undefined ? {} : { chrome: options.chrome }),
  });
  const ui = host.shadowRoot as ShadowRoot;
  return { ...setup, client: shown, page: host, ui, mounted, started, definition };
}

type Shell = Awaited<ReturnType<typeof shell>>;

const buttons = (ui: ShadowRoot): string[] =>
  [...ui.querySelectorAll(".tempuh-actions button")].map((button) => button.textContent?.trim() ?? "");
const buttonNamed = (ui: ShadowRoot, name: string): HTMLButtonElement => {
  const found = [...ui.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
  if (found === undefined) throw new Error(`The page has no button ${JSON.stringify(name)}.`);
  return found;
};
const heading = (ui: ShadowRoot): HTMLElement => ui.querySelector(".tempuh-heading") as HTMLElement;
const contentOf = (ui: ShadowRoot): ShadowRoot =>
  (ui.querySelector(".tempuh-content-host") as HTMLElement).shadowRoot as ShadowRoot;
const statusOf = (ui: ShadowRoot): string => ui.querySelector(".tempuh-status")?.textContent ?? "";
const timerStatusOf = (ui: ShadowRoot): string => ui.querySelector(".tempuh-timer-status")?.textContent ?? "";
const dialogOf = (ui: ShadowRoot): HTMLDialogElement | null => ui.querySelector("dialog.tempuh-confirm");

/** Waits until the content of the first item is on screen. */
const shown = (s: Shell): Promise<void> =>
  vi.waitFor(() => expect(contentOf(s.ui).querySelector(".tempuh-body")?.textContent).toContain("Look at"));

const answer = (identifier: string): CandidateAction => ({
  type: "set-responses",
  item: Q1,
  responses: new Map([["RESPONSE", single("identifier", identifier)]]),
});

describe("mountDelivery", () => {
  it("[T64] shows the rubric of the test, the item with its stimuli and the heading of the item, and keeps the rubric on every item", async () => {
    const s = await shell();
    await shown(s);
    expect(heading(s.ui).textContent).toBe("Item q1");
    const root = contentOf(s.ui);
    expect(root.querySelector(".tempuh-rubric")?.textContent).toContain("Read every question.");
    expect(root.querySelector(".tempuh-body img")?.getAttribute("src")).toBe(
      s.client.assets("items/q1/images/map.png"),
    );
    buttonNamed(s.ui, "Next").click();
    await vi.waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    await vi.waitFor(() =>
      expect(contentOf(s.ui).querySelector(".tempuh-rubric")?.textContent).toContain("Read every question."),
    );
  });

  it("[T54] lists the items of the part with their state, marks the current one and moves to the one the candidate chooses", async () => {
    const s = await shell();
    await shown(s);
    const nav = s.ui.querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe("Questions");
    const items = [...(nav?.querySelectorAll("button") ?? [])];
    expect(items.map((button) => button.textContent)).toEqual([
      "Item q1 (In progress)",
      "Item q2 (Not started)",
      "Item q3 (Not started)",
    ]);
    expect(items.map((button) => button.getAttribute("aria-current"))).toEqual(["true", null, null]);
    items[1]?.click();
    await vi.waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    expect(s.ui.querySelector("nav [aria-current]")?.textContent).toContain("Item q2");
  });

  it("[T54] moves forward only in a linear part: no way back, and the items behind are out of reach", async () => {
    const s = await shell({ files: examFiles({ part: 'navigation-mode="linear" submission-mode="individual"' }) });
    await shown(s);
    expect(s.ui.querySelector("nav")).toBeNull();
    expect(buttons(s.ui)).not.toContain("Previous");
    buttonNamed(s.ui, "Next").click();
    await vi.waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    const nav = [...s.ui.querySelectorAll<HTMLButtonElement>("nav button")];
    expect(nav.map((button) => [button.textContent, button.disabled])).toEqual([
      ["Item q1 (Submitted)", true],
      ["Item q2 (In progress)", false],
    ]);
    expect(buttons(s.ui)).not.toContain("Previous");
  });

  it("[SC 2.4.3] moves the focus to the heading of the item when the item changes, and not when the player starts", async () => {
    const s = await shell();
    await shown(s);
    expect(s.ui.activeElement).toBeNull();
    buttonNamed(s.ui, "Next").click();
    await vi.waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    expect(s.ui.activeElement).toBe(heading(s.ui));
  });

  it("[SC 2.4.3] keeps the focus on the control that has it when a new view arrives, and moves it to the heading when that control is gone", async () => {
    const s = await shell();
    await shown(s);
    const submit = buttonNamed(s.ui, "Submit answer");
    submit.focus();
    expect(s.ui.activeElement).toBe(submit);
    await s.client.dispatch(answer("A"));
    await vi.waitFor(() => expect(s.ui.activeElement?.textContent).toBe("Submit answer"));
    submit.click();
    await vi.waitFor(() => expect(buttons(s.ui)).not.toContain("Submit answer"));
    expect(s.ui.activeElement).toBe(heading(s.ui));
  });

  it("[T55] draws a button for each action of the view, and none for the pause that an exam does not allow", async () => {
    const s = await shell();
    await shown(s);
    expect(buttons(s.ui)).toEqual([
      "Previous",
      "Next",
      "Submit answer",
      "Skip question",
      "End this part",
      "End the test",
    ]);
    expect(buttonNamed(s.ui, "Previous").disabled).toBe(true);
    expect(s.ui.querySelector(".tempuh-actions")?.getAttribute("aria-label")).toBe("Actions");
  });

  it("[T55][T70] lets the candidate pause and resume in practice, where the engine runs on the device", async () => {
    const s = await shell({ practice: true });
    await shown(s);
    expect(buttons(s.ui)).toContain("Pause the test");
    buttonNamed(s.ui, "Pause the test").click();
    await vi.waitFor(() => expect(buttons(s.ui)).toEqual(["Resume the test"]));
    expect(s.ui.querySelector(".tempuh-notice")?.textContent).toBe(
      "The test is paused and your time is stopped. Wait until it continues.",
    );
    buttonNamed(s.ui, "Resume the test").click();
    await vi.waitFor(() => expect(buttons(s.ui)).toContain("Submit answer"));
    expect(s.ui.querySelector(".tempuh-notice")).toBeNull();
  });

  it("[T55] says in words why the engine refused, in the status region and without moving the focus", async () => {
    const s = await shell({ files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await shown(s);
    const submit = buttonNamed(s.ui, "Submit answer");
    submit.focus();
    s.clock.advance(700 * SECOND);
    submit.click();
    await vi.waitFor(() => expect(statusOf(s.ui)).toBe("The time for this question is over."));
    const region = s.ui.querySelector(".tempuh-status");
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(s.ui.activeElement?.textContent).not.toBe("");
  });

  it("[T97][T55] writes the interface in the language of the candidate, the refusals included", async () => {
    const s = await shell({ language: "id", files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await shown(s);
    expect(s.ui.querySelector(".tempuh-player")?.getAttribute("lang")).toBe("id");
    expect(buttons(s.ui)).toEqual([
      "Sebelumnya",
      "Berikutnya",
      "Kirim jawaban",
      "Lewati soal",
      "Akhiri bagian ini",
      "Akhiri tes",
    ]);
    s.clock.advance(700 * SECOND);
    buttonNamed(s.ui, "Kirim jawaban").click();
    await vi.waitFor(() => expect(statusOf(s.ui)).toBe("Waktu untuk soal ini sudah habis."));
  });

  it("[SC 3.3.4][T55] asks before the end of the test, starts on the answer that goes back, and sends nothing when the candidate goes back", async () => {
    const s = await shell();
    await shown(s);
    const version = s.store.records.get("exam-1")?.version;
    const end = buttonNamed(s.ui, "End the test");
    end.focus();
    end.click();
    await vi.waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    const dialog = dialogOf(s.ui) as HTMLDialogElement;
    expect(dialog.getAttribute("aria-label")).toBe("Please confirm");
    expect(dialog.querySelector("p")?.textContent).toBe(
      "End the test? Your answers are submitted and you cannot change them.",
    );
    expect(s.ui.activeElement?.textContent).toBe("No, go back");
    dialog.dispatchEvent(new Event("cancel"));
    dialog.close();
    await vi.waitFor(() => expect(dialogOf(s.ui)).toBeNull());
    expect(s.ui.activeElement).toBe(end);
    expect(s.store.records.get("exam-1")?.version).toBe(version);
  });

  it("[SC 3.3.4][T55] ends the test when the candidate confirms, and tells that it ended", async () => {
    const s = await shell();
    await shown(s);
    buttonNamed(s.ui, "End the test").click();
    await vi.waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    buttonNamed(s.ui, "Yes, continue").click();
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-notice")?.textContent).toBe("The test has ended."));
    expect(buttons(s.ui)).toEqual([]);
    expect(s.ui.activeElement).toBe(heading(s.ui));
  });

  it("[SC 3.3.4] asks before a submit in a linear part, and not in a nonlinear one", async () => {
    const linear = await shell({ files: examFiles({ part: 'navigation-mode="linear" submission-mode="individual"' }) });
    await shown(linear);
    buttonNamed(linear.ui, "Submit answer").click();
    await vi.waitFor(() => expect(dialogOf(linear.ui)?.open).toBe(true));
    expect(dialogOf(linear.ui)?.querySelector("p")?.textContent).toBe(
      "Submit your answer? You cannot change it afterward.",
    );
    buttonNamed(linear.ui, "Yes, continue").click();
    await vi.waitFor(() => expect(buttons(linear.ui)).not.toContain("Submit answer"));
    const nonlinear = await shell();
    await shown(nonlinear);
    buttonNamed(nonlinear.ui, "Submit answer").click();
    await vi.waitFor(() => expect(buttons(nonlinear.ui)).not.toContain("Submit answer"));
    expect(dialogOf(nonlinear.ui)).toBeNull();
  });

  it("[T56] warns how many questions are not submitted when a part ends, and that a simultaneous part submits them together", async () => {
    const s = await shell({ files: examFiles({ part: 'navigation-mode="nonlinear" submission-mode="simultaneous"' }) });
    await shown(s);
    buttonNamed(s.ui, "End this part").click();
    await vi.waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    const sentences = [...(dialogOf(s.ui)?.querySelectorAll("p") ?? [])].map((p) => p.textContent);
    expect(sentences).toEqual([
      "End this part of the test? You cannot return to it.",
      "The answers to all the questions of this part are submitted together when you end it.",
      "Questions not yet submitted: 1",
    ]);
  });

  it("[T57] counts the time left down, announces it five minutes and one minute before the limit and when it is over, and learns of the time-out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const s = await shell({ files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await vi.advanceTimersByTimeAsync(0);
    await real(150);
    const timer = () => s.ui.querySelector(".tempuh-timers")?.textContent;
    expect(timer()).toContain("Time left for this question: 10:00");
    const tick = async (seconds: number): Promise<void> => {
      s.clock.advance(seconds * SECOND);
      await vi.advanceTimersByTimeAsync(seconds * SECOND);
      await real(50);
    };
    await tick(1);
    expect(timer()).toContain("9:59");
    expect(timerStatusOf(s.ui)).toBe("");
    await tick(300);
    expect(timer()).toContain("4:59");
    expect(timerStatusOf(s.ui)).toBe("Time left: 4 minutes 59 seconds");
    await tick(239);
    expect(timerStatusOf(s.ui)).toBe("Time left: 1 minute");
    expect(s.ui.querySelector(".tempuh-timer-status")?.getAttribute("role")).toBe("status");
    await tick(60);
    expect(timerStatusOf(s.ui)).toBe("Time is up.");
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-nav-item")?.textContent).toContain("(Submitted)"));
    await vi.waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
  });

  it("[SC 2.2.1] tells the candidate who reloads inside the last minutes how much time is left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const s = await shell({ files: examFiles({ limits: '<qti-time-limits max-time="200"/>' }) });
    await vi.advanceTimersByTimeAsync(60);
    expect(timerStatusOf(s.ui)).toBe("Time left: 3 minutes 20 seconds");
  });

  it("[SC 2.2.1] lets the candidate hide the timers, and still announces the warnings", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const s = await shell({ files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await vi.advanceTimersByTimeAsync(0);
    await real(100);
    const list = s.ui.querySelector<HTMLElement>(".tempuh-timer-list");
    expect(list?.hidden).toBe(false);
    buttonNamed(s.ui, "Hide the timers").click();
    expect(list?.hidden).toBe(true);
    expect(buttonNamed(s.ui, "Show the timers")).toBeDefined();
    s.clock.advance(301 * SECOND);
    await vi.advanceTimersByTimeAsync(1100);
    expect(timerStatusOf(s.ui)).toBe("Time left: 4 minutes 59 seconds");
  });

  it("[T57] shows the time before the candidate may leave, and that a limit has passed and still takes answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const part = 'navigation-mode="linear" submission-mode="individual"';
    const minimum = await shell({ files: examFiles({ part, limits: '<qti-time-limits min-time="30"/>' }) });
    await vi.advanceTimersByTimeAsync(0);
    await real(150);
    expect(minimum.ui.querySelector(".tempuh-timers")?.textContent).toContain("Time before you may leave: 0:30");
    const late = await shell({
      files: examFiles({ limits: '<qti-time-limits max-time="60" allow-late-submission="true"/>' }),
    });
    await vi.advanceTimersByTimeAsync(0);
    await real(150);
    late.clock.advance(61 * SECOND);
    await vi.advanceTimersByTimeAsync(61 * SECOND);
    await real(150);
    expect(late.ui.querySelector(".tempuh-timers")?.textContent).toContain(
      "Time is up. Answers are still accepted late.",
    );
    expect(buttons(late.ui)).toContain("Submit answer");
  });

  it("[T66] shows the time-out that the host applied when the candidate acts after it", async () => {
    const s = await shell({ files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await shown(s);
    s.clock.advance(601 * SECOND);
    expect((await s.host.host(ALICE.session, { type: "time" })).ok).toBe(true);
    buttonNamed(s.ui, "Next").click();
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-nav-item")?.textContent).toContain("(Submitted)"));
  });

  it("[T58] offers the review and the solution of a closed item", async () => {
    const control = '<qti-item-session-control allow-review="true" show-solution="true"/>';
    const s = await shell({ files: examFiles({ control }) });
    await shown(s);
    buttonNamed(s.ui, "Submit answer").click();
    await vi.waitFor(() => expect(buttons(s.ui)).toContain("Review answer"));
    expect(buttons(s.ui)).toContain("Show solution");
    buttonNamed(s.ui, "Review answer").click();
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-nav-item")?.textContent).toContain("(In review)"));
    buttonNamed(s.ui, "Show solution").click();
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-nav-item")?.textContent).toContain("(Solution shown)"));
  });

  it("[T59] draws a comment box where the item allows a comment, and sends the comment", async () => {
    const withoutComment = await shell();
    await shown(withoutComment);
    expect(withoutComment.ui.querySelector<HTMLElement>(".tempuh-comment")?.hidden).toBe(true);
    const s = await shell({ files: examFiles({ control: '<qti-item-session-control allow-comment="true"/>' }) });
    await shown(s);
    const form = s.ui.querySelector<HTMLFormElement>(".tempuh-comment");
    expect(form?.hidden).toBe(false);
    const field = form?.querySelector("textarea") as HTMLTextAreaElement;
    expect(form?.querySelector("label")?.getAttribute("for")).toBe(field.id);
    expect(form?.querySelector("label")?.textContent).toBe("Comment on this question");
    field.value = "Unclear wording.";
    buttonNamed(s.ui, "Save comment").click();
    await vi.waitFor(() => expect(statusOf(s.ui)).toBe("Comment saved."));
    await s.client.dispatch({ type: "move", to: "next" });
    await vi.waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    expect(form?.hidden).toBe(true);
  });

  it("[T60] marks an item that depends on time", async () => {
    const files = { ...examFiles() };
    files["items/q2/item.xml"] = String(files["items/q2/item.xml"]).replace(
      'time-dependent="false"',
      'time-dependent="true"',
    );
    const s = await shell({ files });
    await shown(s);
    expect(s.ui.querySelector(".tempuh-notice")).toBeNull();
    buttonNamed(s.ui, "Next").click();
    await vi.waitFor(() =>
      expect(s.ui.querySelector(".tempuh-notice")?.textContent).toBe(
        "This question is timed. Your time counts while you work on it.",
      ),
    );
  });

  it("[T62] tells how many attempts the candidate has used and has left", async () => {
    const control = '<qti-item-session-control max-attempts="2" show-feedback="true"/>';
    const s = await shell({ files: examFiles({ control }) });
    await shown(s);
    expect(s.ui.querySelector(".tempuh-attempts")?.textContent).toBe("Attempts used: 1. Attempts left: 2");
  });

  it("[T61] shows a break that the proctor made, and the candidate can do nothing until the proctor ends it", async () => {
    const s = await shell();
    await shown(s);
    expect((await s.host.proctor(ALICE.session, { type: "suspend" })).ok).toBe(true);
    buttonNamed(s.ui, "Skip question").click();
    await vi.waitFor(() => expect(statusOf(s.ui)).toBe("The test is paused, so this action is not possible."));
    expect(s.ui.querySelector(".tempuh-notice")?.textContent).toBe(
      "The test is paused and your time is stopped. Wait until it continues.",
    );
    expect(buttons(s.ui)).toEqual([]);
    expect((await s.host.proctor(ALICE.session, { type: "resume" })).ok).toBe(true);
    s.mounted.destroy();
    const reloaded = createRemoteSession(
      async (envelope) => JSON.parse(JSON.stringify(await s.host.handle(ALICE, JSON.parse(JSON.stringify(envelope))))),
      JSON.parse(JSON.stringify(await s.host.view(ALICE))),
      { clock: s.clock },
    );
    expect(reloaded.view.status).toBe("in-progress");
    reloaded.close();
  });

  it("[T69] mounts a session that the store restored, where the candidate left it", async () => {
    const s = await shell();
    await shown(s);
    await s.client.dispatch({ type: "move", to: "next" });
    await vi.waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    s.mounted.destroy();
    const view = JSON.parse(JSON.stringify(await s.host.view(ALICE)));
    const client = createRemoteSession(
      async (envelope) => JSON.parse(JSON.stringify(await s.host.handle(ALICE, JSON.parse(JSON.stringify(envelope))))),
      view,
      { clock: s.clock },
    );
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    mountDelivery(host, {
      client,
      files: {
        upload: async () => ({ reference: "f", mimeType: "image/png" }),
        read: async () => new Uint8Array(),
        url: () => "",
      },
      staticUrl: `${inject("fixtures").asset}/static/`,
      stylesheet: player,
      fetch: async () => ({ ok: false, status: 404, text: async () => "" }),
    });
    const ui = host.shadowRoot as ShadowRoot;
    expect(heading(ui).textContent).toBe("Item q2");
    expect(ui.querySelector("nav [aria-current]")?.textContent).toContain("Item q2");
    client.close();
  });

  it("[SC 4.1.3] announces the result of an action in a status region and not in the focus", async () => {
    const s = await shell({ files: examFiles({ control: '<qti-item-session-control allow-comment="true"/>' }) });
    await shown(s);
    const field = s.ui.querySelector("textarea") as HTMLTextAreaElement;
    field.focus();
    field.value = "Fine.";
    buttonNamed(s.ui, "Save comment").click();
    await vi.waitFor(() => expect(statusOf(s.ui)).toBe("Comment saved."));
    expect(s.ui.activeElement).toBe(field);
    for (const selector of [".tempuh-status", ".tempuh-timer-status"]) {
      const region = s.ui.querySelector(selector);
      expect(region?.getAttribute("role"), selector).toBe("status");
      expect(region?.getAttribute("aria-atomic"), selector).toBe("true");
    }
  });

  it("[SC 4.1.3] says that the answers could not be sent, and that they were rejected", async () => {
    const failing = await shell({
      wrap: (client) =>
        ({ ...client, dispatch: async () => Promise.reject(new TypeError("Failed to fetch")) }) as never,
    });
    await shown(failing);
    const ignore = (event: ErrorEvent): void => event.preventDefault();
    window.addEventListener("error", ignore);
    try {
      buttonNamed(failing.ui, "Skip question").click();
      await vi.waitFor(() =>
        expect(statusOf(failing.ui)).toBe("Your answers could not be sent. They will be sent again."),
      );
    } finally {
      window.removeEventListener("error", ignore);
    }
    const rejecting = await shell({
      wrap: (client) => withDispatch(client, async () => Promise.reject(new DataError("No."))),
    });
    await shown(rejecting);
    buttonNamed(rejecting.ui, "Skip question").click();
    await vi.waitFor(() => expect(statusOf(rejecting.ui)).toBe("The test could not accept this action."));
  });

  it("draws the content alone when the host draws the chrome", async () => {
    const s = await shell({ chrome: false });
    await shown(s);
    expect(s.ui.querySelector(".tempuh-actions button")).toBeNull();
    expect(s.ui.querySelector("nav")).toBeNull();
    expect(s.ui.querySelector(".tempuh-timers")).toBeNull();
  });

  it("takes the content and the timers away at destroy, and leaves the session to its host", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const s = await shell({ files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await vi.advanceTimersByTimeAsync(0);
    await real(150);
    const timers = vi.getTimerCount();
    s.mounted.destroy();
    s.mounted.destroy();
    expect(s.ui.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBeLessThan(timers);
    const moved = await s.client.dispatch({ type: "move", to: "next" });
    expect(moved.view.current?.key.ref).toBe("q2");
  });

  it("checks its arguments", async () => {
    const s = await shell();
    const options = {
      client: s.client,
      files: {
        upload: async () => ({ reference: "f", mimeType: "x" }),
        read: async () => new Uint8Array(),
        url: () => "",
      },
      staticUrl: "https://s.example/",
      stylesheet: player,
      fetch: async () => ({ ok: true, status: 200, text: async () => "" }),
    };
    const fresh = (): HTMLElement => document.createElement("div");
    const mount = (host: unknown, changes: Record<string, unknown> = {}): unknown =>
      mountDelivery(host as HTMLElement, { ...options, ...changes });
    expect(() => mount(null)).toThrow("The host must be an element, found null.");
    expect(() => mount(s.page)).toThrow("The host must be an element that has no shadow root.");
    expect(() => mount(fresh(), { staticUrl: "https://s.example" })).toThrow('The option staticUrl must end in "/"');
    expect(() => mount(fresh(), { stylesheet: "css" })).toThrow("The option stylesheet must be a CSSStyleSheet");
    expect(() => mount(fresh(), { fetch: null })).toThrow("The option fetch must be a function");
    expect(() => mount(fresh(), { files: { upload: 1 } })).toThrow("The function upload of the option files");
    expect(() => mount(fresh(), { language: "" })).toThrow("The option language must be a non-empty string");
    expect(() => mount(fresh(), { origins: ["ftp://x"] })).toThrow("An origin of the option origins");
    expect(() => mount(fresh(), { chrome: "yes" })).toThrow("The option chrome must be true or false");
    expect(() => mount(fresh(), { hooks: { voice: {} } })).toThrow("The method speak of the hook voice");
    expect(() => mount(fresh(), { hooks: { voice: "robot" } })).toThrow("The hook voice must be an object");
    expect(() => mount(fresh(), { client: {} })).toThrow("The function age of the option client");
    expect(() => mount(fresh(), { other: 1 })).toThrow("The options has the properties");
  });
});

/** The item q3 of the fixture as a portable custom interaction on a module that the fixtures serve. */
function pciFiles(): Readonly<Record<string, string | Uint8Array>> {
  const files = { ...examFiles() };
  files["items/q3/item.xml"] = String(files["items/q3/item.xml"])
    .replace('module="pci-module"', 'module="simple"')
    .replace(
      'custom-interaction-type-identifier="urn:test:pci"',
      'custom-interaction-type-identifier="urn:test:simple"',
    )
    .replace(
      /<qti-interaction-modules[\s\S]*<\/qti-interaction-modules>/u,
      '<qti-interaction-modules><qti-interaction-module id="simple" primary-path="modules/simple"/></qti-interaction-modules>',
    )
    .replace(
      "<qti-interaction-markup><p>Tap</p></qti-interaction-markup>",
      '<qti-prompt>Press the button</qti-prompt><qti-interaction-markup><div id="press" data-role="button">Press</div></qti-interaction-markup>',
    );
  return files;
}

describe("a portable custom interaction in the player", () => {
  it("[T67] stores the response and the state of the interaction with the session, so that it restores on another device", async () => {
    const s = await shell({
      files: pciFiles(),
      wrap: (client) =>
        Object.create(client, { assets: { value: (path: string) => `${inject("fixtures").asset}/g/pci/${path}` } }),
    });
    // The interaction's files come from the fixtures server: the player fetches its module resolution through `fetch`.
    await shown(s);
    await s.client.dispatch({ type: "move", to: { ref: "q3", instance: 1 } });
    await vi.waitFor(() => expect(heading(s.ui).textContent).toBe("Item q3"));
    await vi.waitFor(() => expect(contentOf(s.ui).querySelector("iframe")).not.toBeNull());
    await vi.waitFor(
      async () => {
        await commands.clickInFrame("Press the button", "#press");
      },
      { timeout: 15_000 },
    );
    await vi.waitFor(
      () => {
        const stored = s.store.records.get("exam-1");
        expect(stored?.version).toBeGreaterThan(1);
      },
      { timeout: 15_000 },
    );
    const view = s.client.view.current;
    await vi.waitFor(() => expect(statusOf(s.ui)).toBe("Answers saved."), { timeout: 10_000 });
    await vi.waitFor(() => expect(s.client.view.current?.responses.get("PCI")).toBeDefined(), { timeout: 10_000 });
    expect(s.client.view.current?.responses.get("PCI")).toEqual(single("integer", 1));
    expect(s.client.view.current?.pci.get("PCI")?.state).toBe('{"count":1}');
    expect(view?.key.ref).toBe("q3");
  });
});

/** The radio buttons of the choice interaction of the item shown, in the order of the choices. */
const choices = (ui: ShadowRoot): HTMLInputElement[] => [
  ...contentOf(ui).querySelectorAll<HTMLInputElement>("qti-choice-interaction input.tempuh-control"),
];

describe("the interactions in the player", () => {
  it("[T67][T55] sends the response that the candidate gives, and tells that the answers are saved", async () => {
    const s = await shell();
    await vi.waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    choices(s.ui)[1]?.click();
    await vi.waitFor(() => expect(statusOf(s.ui)).toBe("Answers saved."), { timeout: 5000 });
    expect(s.client.view.current?.responses.get("RESPONSE")).toEqual(single("identifier", "B"));
    expect(choices(s.ui).map((input) => input.checked)).toEqual([false, true]);
  });

  it("[T67] keeps what the candidate chose when a view that answers an earlier request arrives", async () => {
    const s = await shell();
    await vi.waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    choices(s.ui)[1]?.click();
    const current = s.client.view.current;
    if (current === undefined) throw new Error("The fixture shows an item.");
    s.mounted.update({
      ...s.client.view,
      current: { ...current, responses: new Map([["RESPONSE", single("identifier", "A")]]) },
    });
    await real(50);
    expect(choices(s.ui).map((input) => input.checked)).toEqual([false, true]);
  });

  it("[T67] sends the held response before the submit, so that the engine submits what the candidate chose", async () => {
    const control = '<qti-item-session-control allow-review="true" show-solution="true"/>';
    const s = await shell({ files: examFiles({ control }) });
    await vi.waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    choices(s.ui)[1]?.click();
    buttonNamed(s.ui, "Submit answer").click();
    await vi.waitFor(() => expect(buttons(s.ui)).toContain("Review answer"));
    expect(s.client.view.current?.responses.get("RESPONSE")).toEqual(single("identifier", "B"));
  });

  it("[T58] disables the interactions of a closed item, and shows the answer in the review and the correct one in the solution", async () => {
    const control = '<qti-item-session-control allow-review="true" show-solution="true"/>';
    const s = await shell({ files: examFiles({ control }) });
    await vi.waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    expect(choices(s.ui).map((input) => input.disabled)).toEqual([false, false]);
    choices(s.ui)[1]?.click();
    buttonNamed(s.ui, "Submit answer").click();
    await vi.waitFor(() => expect(buttons(s.ui)).toContain("Review answer"));
    await vi.waitFor(() => expect(choices(s.ui).map((input) => input.disabled)).toEqual([true, true]));
    expect(choices(s.ui).map((input) => input.checked)).toEqual([false, true]);
    buttonNamed(s.ui, "Review answer").click();
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-nav-item")?.textContent).toContain("(In review)"));
    await vi.waitFor(() => expect(choices(s.ui).map((input) => input.disabled)).toEqual([true, true]));
    expect(choices(s.ui).map((input) => input.checked)).toEqual([false, true]);
    buttonNamed(s.ui, "Show solution").click();
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-nav-item")?.textContent).toContain("(Solution shown)"));
    await vi.waitFor(() => expect(choices(s.ui).map((input) => input.checked)).toEqual([true, false]));
    expect(choices(s.ui).map((input) => input.disabled)).toEqual([true, true]);
  });
});

describe("accessibility of the chrome", () => {
  it("[T55][SC 4.1.2] has no violation of WCAG 2.2 A and AA when it runs, asks, pauses and ends", async () => {
    const s = await shell({ practice: true, files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await shown(s);
    expect(await axeViolations(s.page)).toEqual([]);
    buttonNamed(s.ui, "End the test").click();
    await vi.waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    expect(await axeViolations(s.page)).toEqual([]);
    buttonNamed(s.ui, "No, go back").click();
    await vi.waitFor(() => expect(dialogOf(s.ui)).toBeNull());
    buttonNamed(s.ui, "Pause the test").click();
    await vi.waitFor(() => expect(buttons(s.ui)).toEqual(["Resume the test"]));
    expect(await axeViolations(s.page)).toEqual([]);
    buttonNamed(s.ui, "Resume the test").click();
    await vi.waitFor(() => expect(buttons(s.ui)).toContain("End the test"));
    buttonNamed(s.ui, "End the test").click();
    await vi.waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    buttonNamed(s.ui, "Yes, continue").click();
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-notice")?.textContent).toBe("The test has ended."));
    expect(await axeViolations(s.page)).toEqual([]);
  });

  it("[T55][SC 2.1.1] is operated with the keyboard alone: the map comes before the actions, and Enter and Space press a button", async () => {
    const s = await shell();
    await shown(s);
    // The order of the page is the order of the Tab key in every engine that puts buttons in it; Safari's setting leaves them out.
    const order = [...s.ui.querySelectorAll<HTMLElement>("[data-focus-id]")]
      .filter(
        (element) =>
          !(element instanceof HTMLButtonElement && element.disabled) && element.closest("[hidden]") === null,
      )
      .map((element) => element.getAttribute("data-focus-id"));
    expect(order).toEqual(["item q1 1", "item q2 1", "item q3 1", "next", "submit", "skip", "end-part", "end-test"]);
    expect([...s.ui.querySelectorAll("button")].every((button) => button.tabIndex >= 0)).toBe(true);
    buttonNamed(s.ui, "Next").focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    buttonNamed(s.ui, "Previous").focus();
    await userEvent.keyboard(" ");
    await vi.waitFor(() => expect(heading(s.ui).textContent).toBe("Item q1"));
  });

  it("[SC 2.4.3] gives the focus to the answer that goes back, and back to the control that asked", async () => {
    const s = await shell();
    await shown(s);
    const end = buttonNamed(s.ui, "End this part");
    end.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    expect(s.ui.activeElement?.textContent).toBe("No, go back");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(dialogOf(s.ui)).toBeNull());
    expect(s.ui.activeElement).toBe(end);
    end.click();
    await vi.waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    const yes = buttonNamed(s.ui, "Yes, continue");
    expect(yes.tabIndex).toBeGreaterThanOrEqual(0);
    yes.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(dialogOf(s.ui)).toBeNull());
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-notice")?.textContent).toBe("The test has ended."));
  });
});

const PNP_NAMESPACE = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0pnp_v1p0";

/** A profile with two supports the candidate turns on and off, one that is on from the start, one that is on and read aloud, and one prohibited. */
const PROFILE = `<access-for-all-pnp xmlns="${PNP_NAMESPACE}">
  <high-contrast/><alternative-text/><layout-single-column/><magnification/>
  <spoken><reading-type>computer-read-aloud</reading-type></spoken>
  <activate-as-option-set><high-contrast/><alternative-text/></activate-as-option-set>
  <activate-at-initialization-set><layout-single-column/><spoken/></activate-at-initialization-set>
  <prohibit-set><magnification/></prohibit-set>
</access-for-all-pnp>`;

const panelButtons = (ui: ShadowRoot): HTMLButtonElement[] => [
  ...ui.querySelectorAll<HTMLButtonElement>(".tempuh-supports button"),
];
const contentHostOf = (ui: ShadowRoot): HTMLElement => ui.querySelector(".tempuh-content-host") as HTMLElement;

/** A session client that records the actions it is sent. */
function recording(): { readonly sent: CandidateAction[]; readonly wrap: (client: SessionClient) => SessionClient } {
  const sent: CandidateAction[] = [];
  return {
    sent,
    wrap: (client) =>
      withDispatch(client, (action) => {
        sent.push(action);
        return client.dispatch(action);
      }),
  };
}

describe("the supports in the player", () => {
  it("[T75] draws a toggle button for each support that is an option, and none for a support that is on from the start or prohibited", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    const region = s.ui.querySelector(".tempuh-supports");
    expect(region?.getAttribute("aria-label")).toBe("Supports");
    expect(panelButtons(s.ui).map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([
      ["High contrast", "false"],
      ["Alternative text", "false"],
    ]);
  });

  it("[T75] has no panel for a candidate whose profile gives no option", async () => {
    const s = await shell();
    await shown(s);
    expect(s.ui.querySelector(".tempuh-supports")?.hasAttribute("hidden")).toBe(true);
    expect(panelButtons(s.ui).filter((button) => button.offsetParent !== null)).toEqual([]);
  });

  it("[T75][T79] sends the support action through the session, applies the support to the next view and takes it off when pressed again", async () => {
    const { sent, wrap } = recording();
    const s = await shell({ profile: PROFILE, wrap });
    await shown(s);
    const host = contentHostOf(s.ui);
    expect(host.hasAttribute("data-tempuh-contrast")).toBe(false);
    buttonNamed(s.ui, "High contrast").click();
    await vi.waitFor(() => expect(host.getAttribute("data-tempuh-contrast")).toBe("high"));
    expect(sent).toContainEqual({ type: "support", name: "high-contrast", active: true });
    expect(buttonNamed(s.ui, "High contrast").getAttribute("aria-pressed")).toBe("true");
    buttonNamed(s.ui, "High contrast").click();
    await vi.waitFor(() => expect(host.hasAttribute("data-tempuh-contrast")).toBe(false));
    expect(sent).toContainEqual({ type: "support", name: "high-contrast", active: false });
    expect(buttonNamed(s.ui, "High contrast").getAttribute("aria-pressed")).toBe("false");
  });

  it("[T75][SC 2.4.3] keeps the focus on the button that turned a support, and says nothing in the status region", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    const button = buttonNamed(s.ui, "High contrast");
    button.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    expect(s.ui.activeElement).toBe(button);
    expect(statusOf(s.ui)).toBe("");
  });

  it("[T84] shows the alternative text of an image after the support is turned on, without drawing the content again", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    const body = contentOf(s.ui).querySelector(".tempuh-body");
    expect(contentOf(s.ui).querySelector(".tempuh-body")?.textContent).not.toContain("A map");
    buttonNamed(s.ui, "Alternative text").click();
    await vi.waitFor(() => expect(contentOf(s.ui).querySelector(".tempuh-body")?.textContent).toContain("A map"));
    expect(contentOf(s.ui).querySelector(".tempuh-body")).toBe(body);
    buttonNamed(s.ui, "Alternative text").click();
    await vi.waitFor(() => expect(contentOf(s.ui).querySelector(".tempuh-body")?.textContent).not.toContain("A map"));
  });

  it("[T84] leaves what the supports added alone while the answers are saved, and applies them again to the next item", async () => {
    const s = await shell({ profile: PROFILE });
    await vi.waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    buttonNamed(s.ui, "Alternative text").click();
    await vi.waitFor(() => expect(contentOf(s.ui).querySelector(".tempuh-body")?.textContent).toContain("A map"));
    const after = [...contentOf(s.ui).querySelectorAll("img + *")].find((node) => node.textContent === "A map");
    expect(after).toBeDefined();
    choices(s.ui)[1]?.click();
    await vi.waitFor(() => expect(statusOf(s.ui)).toBe("Answers saved."), { timeout: 5000 });
    expect(after?.isConnected).toBe(true);
    buttonNamed(s.ui, "Next").click();
    await vi.waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    await vi.waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    expect(buttonNamed(s.ui, "Alternative text").getAttribute("aria-pressed")).toBe("true");
  });

  it("[T79] applies a support that is on from the start, and draws no control for it", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    expect(contentHostOf(s.ui).hasAttribute("data-tempuh-single-column")).toBe(true);
    expect(panelButtons(s.ui).map((button) => button.textContent)).not.toContain("Single column");
  });

  it("[T75][T79] applies the supports to the content when the host draws the chrome, and draws no panel", async () => {
    const s = await shell({ profile: PROFILE, chrome: false });
    await shown(s);
    expect(contentHostOf(s.ui).hasAttribute("data-tempuh-single-column")).toBe(true);
    expect(s.ui.querySelector(".tempuh-supports")).toBeNull();
  });

  it("[T75][T97] names the supports in the language of the interface", async () => {
    const s = await shell({ profile: PROFILE, language: "id" });
    await vi.waitFor(() => expect(panelButtons(s.ui)).toHaveLength(2));
    expect(s.ui.querySelector(".tempuh-supports")?.getAttribute("aria-label")).toBe(ID_MESSAGES.supportsLabel);
  });

  it("[T85] reads the content with the voice of the host when the profile asks for it", async () => {
    const requests: SpeechRequest[] = [];
    const voice = {
      speak: async (request: SpeechRequest): Promise<void> => void requests.push(request),
      stop: () => undefined,
    };
    const s = await shell({ profile: PROFILE, voice });
    await shown(s);
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-read-aloud")?.hasAttribute("hidden")).toBe(false));
    buttonNamed(s.ui, "Read aloud").click();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.text).toContain("Look at");
    expect(requests[0]?.lang).toBe("en");
  });

  it("[T79][T87] changes the look inside the frame of a portable custom interaction when a support is turned on and off", async () => {
    const s = await shell({
      files: pciFiles(),
      profile: PROFILE,
      wrap: (client) =>
        Object.create(client, { assets: { value: (path: string) => `${inject("fixtures").asset}/g/pci/${path}` } }),
    });
    await shown(s);
    await s.client.dispatch({ type: "move", to: { ref: "q3", instance: 1 } });
    await vi.waitFor(() => expect(contentOf(s.ui).querySelector("iframe")).not.toBeNull());
    const look = async () => (await commands.frameTheme("Press the button")).attributes["data-tempuh-contrast"];
    await vi.waitFor(async () => expect(await look()).toBeUndefined(), { timeout: 15_000 });
    buttonNamed(s.ui, "High contrast").click();
    await vi.waitFor(async () => expect(await look()).toBe("high"), { timeout: 15_000 });
    buttonNamed(s.ui, "High contrast").click();
    await vi.waitFor(async () => expect(await look()).toBeUndefined(), { timeout: 15_000 });
  });

  it("[T74] says which version of the question was delivered", async () => {
    const s = await shell();
    await shown(s);
    const current = s.client.view.current;
    if (current === undefined) throw new Error("The fixture shows an item.");
    const notice = (): HTMLElement => s.ui.querySelector(".tempuh-variant") as HTMLElement;
    expect(notice().hidden).toBe(true);
    s.mounted.update({ ...s.client.view, current: { ...current, variant: { resource: "q1-id", language: "id" } } });
    await vi.waitFor(() => expect(notice().textContent).toBe("Language of this version: Indonesian"));
    expect(notice().querySelector("span")?.getAttribute("lang")).toBe("id");
    s.mounted.update({ ...s.client.view, current });
    await vi.waitFor(() => expect(notice().hidden).toBe(true));
  });

  it("[T75][SC 4.1.2] has no violation of WCAG 2.2 A and AA with the panel and the controls of reading aloud", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-read-aloud")?.hasAttribute("hidden")).toBe(false));
    expect(await axeViolations(s.page)).toEqual([]);
  });

  it("takes the panel and the controls away at destroy", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    s.mounted.destroy();
    expect(s.ui.childElementCount).toBe(0);
  });
});

/** The item q1 as a drawing on a white picture: its response is a file that the host stores. */
function drawingFiles(): Readonly<Record<string, string | Uint8Array>> {
  return {
    ...examFiles(),
    "items/q1/item.xml": `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="q1" title="Item q1" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="file"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>
  <qti-item-body>
    <p>Look at the picture.</p>
    <qti-drawing-interaction response-identifier="RESPONSE"><qti-prompt>Draw.</qti-prompt><object type="image/png" width="200" height="100" data="${picture(200, 100, "#ffffff")}">A canvas</object></qti-drawing-interaction>
  </qti-item-body>
</qti-assessment-item>`,
  };
}

/** A storage of drawings that keeps the upload pending until the test lets it go; a stored drawing plays back as a white picture. */
function slowUpload(): {
  readonly files: Pick<Parameters<typeof shell>[0] & object, "upload" | "url">;
  readonly uploads: () => number;
  readonly finish: () => void;
} {
  const pending: (() => void)[] = [];
  const stored = picture(200, 100, "#ffffff");
  let count = 0;
  return {
    files: {
      upload: (_bytes, mimeType) =>
        new Promise((resolve) => {
          count += 1;
          const reference = `drawing-${count}`;
          pending.push(() => resolve({ reference, mimeType }));
        }),
      url: () => stored,
    },
    uploads: () => count,
    finish: () => {
      for (const release of pending.splice(0)) release();
    },
  };
}

/** Draws a line, and waits until the drawing has started to store it. */
async function draw(s: Shell, storage: ReturnType<typeof slowUpload>): Promise<void> {
  const surface = (): HTMLElement | null => contentOf(s.ui).querySelector<HTMLElement>(".tempuh-surface");
  await vi.waitFor(() => expect(surface()?.getBoundingClientRect().width).toBeGreaterThan(0));
  const target = surface() as HTMLElement;
  await userEvent.dragAndDrop(target, target, { sourcePosition: { x: 20, y: 20 }, targetPosition: { x: 120, y: 20 } });
  await vi.waitFor(() => expect(storage.uploads()).toBe(1));
}

describe("a drawing that is still being stored", () => {
  const types = (sent: readonly CandidateAction[]): string[] => sent.map(({ type }) => type);

  it.each([
    ["submit", async (s: Shell) => buttonNamed(s.ui, "Submit answer").click(), "submit"],
    ["move to the next question", async (s: Shell) => buttonNamed(s.ui, "Next").click(), "move"],
    [
      "choose another question in the map",
      async (s: Shell) => (s.ui.querySelectorAll(".tempuh-nav-item")[1] as HTMLElement).click(),
      "move",
    ],
  ] as const)(
    "sends the drawing before the candidate's request to %s, and not before it is stored",
    async (_name, act, type) => {
      const { sent, wrap } = recording();
      const storage = slowUpload();
      const s = await shell({ files: drawingFiles(), wrap, ...storage.files });
      await shown(s);
      await draw(s, storage);
      await act(s);
      await real(200);
      expect(types(sent)).not.toContain(type);
      expect(types(sent)).not.toContain("set-responses");
      storage.finish();
      await vi.waitFor(() => expect(types(sent)).toContain(type));
      expect(types(sent).filter((each) => each === "set-responses" || each === type)).toEqual(["set-responses", type]);
      const response = sent.find((action) => action.type === "set-responses");
      expect(response?.type === "set-responses" && response.responses.get("RESPONSE")).toMatchObject({
        cardinality: "single",
        baseType: "file",
        value: { reference: "drawing-1" },
      });
    },
  );

  it("[SC 3.3.4] sends the drawing before the end of the test, once the candidate has confirmed", async () => {
    const { sent, wrap } = recording();
    const storage = slowUpload();
    const s = await shell({ files: drawingFiles(), wrap, ...storage.files });
    await shown(s);
    await draw(s, storage);
    buttonNamed(s.ui, "End the test").click();
    await vi.waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    buttonNamed(s.ui, "Yes, continue").click();
    await real(200);
    expect(types(sent)).not.toContain("end-test");
    storage.finish();
    await vi.waitFor(() => expect(types(sent)).toContain("end-test"));
    expect(types(sent).filter((each) => each === "set-responses" || each === "end-test")).toEqual([
      "set-responses",
      "end-test",
    ]);
    await vi.waitFor(() => expect(s.ui.querySelector(".tempuh-notice")?.textContent).toBe("The test has ended."));
  });

  it("keeps the stored drawing in the answer the engine submitted", async () => {
    const storage = slowUpload();
    const s = await shell({ files: drawingFiles(), ...storage.files });
    await shown(s);
    await draw(s, storage);
    buttonNamed(s.ui, "Submit answer").click();
    storage.finish();
    await vi.waitFor(() => expect(s.client.view.current?.status).toBe("closed"));
    expect(s.client.view.current?.responses.get("RESPONSE")).toMatchObject({ value: { reference: "drawing-1" } });
  });

  it("lets a host that draws its own actions wait for the drawing", async () => {
    const storage = slowUpload();
    const s = await shell({ files: drawingFiles(), ...storage.files, chrome: false });
    await shown(s);
    await draw(s, storage);
    let settled = false;
    void s.mounted.settled().then(() => {
      settled = true;
    });
    await real(200);
    expect(settled).toBe(false);
    storage.finish();
    await vi.waitFor(() => expect(settled).toBe(true));
    await vi.waitFor(() =>
      expect(s.client.view.current?.responses.get("RESPONSE")).toMatchObject({ value: { reference: "drawing-1" } }),
    );
  });

  it("sends a request at once when no interaction has work to finish", async () => {
    const { sent, wrap } = recording();
    const s = await shell({ wrap });
    await shown(s);
    buttonNamed(s.ui, "Next").click();
    await vi.waitFor(() => expect(types(sent)).toEqual(["move"]));
  });
});
