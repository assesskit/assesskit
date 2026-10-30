import type { CandidateAction } from "@luthfanwakan/olah/delivery";
import { single } from "@luthfanwakan/olah/values";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { createLocalSession, createRemoteSession, type Transport } from "../src/client/index.js";
import { DataError } from "../src/index.js";
import type { StylesheetFetch } from "../src/player/index.js";
import { mountDelivery } from "../src/player/index.js";
import type { SessionClient } from "../src/protocol/index.js";
import { PLAYER_CSS } from "./css-fixture.js";
import { examDefinition, examFiles, examHost, packageOf } from "./exam-fixture.js";
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
  } = {},
) {
  const origin = inject("fixtures").asset;
  const setup = await examHost({}, options.files, origin);
  const definition = examDefinition(packageOf(options.files ?? examFiles()));
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
      assets: (path) => `${origin}${PRACTICE_PATH}${path}`,
      clock: setup.clock,
    });
  } else {
    const transport: Transport = async (envelope) =>
      JSON.parse(JSON.stringify(await setup.host.handle(ALICE, JSON.parse(JSON.stringify(envelope)))));
    started = JSON.parse(JSON.stringify(await setup.host.start(ALICE, { seed: 1 })));
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
      upload: async () => ({ reference: "f", mimeType: "image/png" }),
      read: async () => new Uint8Array(),
      url: () => "",
    },
    staticUrl: `${origin}/static/`,
    stylesheet: player,
    fetch: fetcher,
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
