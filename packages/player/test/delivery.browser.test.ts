import { ASI_NAMESPACE } from "@assesskit/runtime/asi";
import type { CandidateAction } from "@assesskit/runtime/delivery";
import { createEngine } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { readPnp } from "@assesskit/runtime/pnp";
import { type FileValue, single } from "@assesskit/runtime/values";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { createLocalSession, createRemoteSession, type Transport } from "../src/client/index.js";
import { ID_MESSAGES } from "../src/index.js";
import type { MountFiles, SpeechRequest, StylesheetFetch, ToolSlots } from "../src/player/index.js";
import { mountDelivery } from "../src/player/index.js";
import { HOST_SHADOW_RULE } from "../src/player/internal.js";
import type { HostSession, SessionClient } from "../src/protocol/index.js";
import { audioContextRuns, fakeMicrophone, heard, needsAudio } from "./audio.js";
import { computed, PLAYER_CSS } from "./css-fixture.js";
import { examDefinition, examFiles, examHost, lexiconFiles, packageOf, pciFiles } from "./exam-fixture.js";
import { NO_RECORDING } from "./files-fixture.js";
import { picture, settle } from "./graphic-fixture.js";
import { axeViolations } from "./renderer-fixture.js";
import { calculatorXml, protractorXml, ruleXml } from "./tools-fixture.js";
import { waitFor } from "./wait.js";

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
    /** Whether the engine allows a review after the end. */
    readonly reviewAfterEnd?: boolean;
    readonly chrome?: boolean;
    /** Replaces the fetch of the page, which loads the stylesheets of the item. */
    readonly fetch?: StylesheetFetch;
    /** Receives the errors that the player can only report. */
    readonly onError?: (error: unknown) => void;
    readonly landmark?: "main" | "region";
    readonly headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
    readonly marking?: boolean;
    readonly wrap?: (client: SessionClient) => SessionClient;
    /** The PNP of the candidate, as a document. */
    readonly profile?: string;
    readonly upload?: (bytes: Blob, mimeType: string) => Promise<FileValue>;
    readonly url?: (file: FileValue) => string;
    /** Names a file whose bytes come later, as a recording does. */
    readonly reserve?: MountFiles["reserve"];
    /** Stores the bytes of a reserved file. */
    readonly fill?: MountFiles["fill"];
    readonly voice?: { speak(request: SpeechRequest): Promise<void>; stop(): void };
    readonly tools?: ToolSlots;
  } = {},
) {
  const origin = inject("fixtures").asset;
  const definition = examDefinition(packageOf(options.files ?? examFiles()));
  const engineOptions = options.reviewAfterEnd === true ? { reviewAfterEnd: true } : {};
  const setup = await examHost({ engine: createEngine(definition, engineOptions) }, options.files, origin);
  const pnp = options.profile === undefined ? undefined : readPnp(options.profile);
  if (pnp !== undefined && !("supports" in pnp)) throw new Error("The fixture profile must be one profile.");
  const profile = pnp === undefined ? {} : { pnp };
  let client: SessionClient;
  let started: unknown;
  // The host side of the session: the practice client offers its own, an exam has the session host.
  let hostSession: HostSession = setup.host.session(ALICE.session);
  if (options.practice === true) {
    const saved = new Map<string, string>();
    const local = await createLocalSession({
      definition,
      store: {
        load: async (session) => saved.get(session),
        save: async (session, { state }) => void saved.set(session, state),
      },
      session: "practice-1",
      seed: 1,
      engine: engineOptions,
      start: profile,
      assets: (path) => `${origin}${PRACTICE_PATH}${path}`,
      clock: setup.clock,
    });
    client = local;
    hostSession = local.host;
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
      ...NO_RECORDING,
      ...(options.reserve === undefined ? {} : { reserve: options.reserve }),
      ...(options.fill === undefined ? {} : { fill: options.fill }),
    },
    staticUrl: `${origin}/static/`,
    stylesheet: player,
    fetch: options.fetch ?? fetcher,
    hooks: {
      ...(options.onError === undefined ? {} : { onError: options.onError }),
      ...(options.voice === undefined ? {} : { voice: options.voice }),
      ...(options.tools === undefined ? {} : { tools: options.tools }),
    },
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.chrome === undefined ? {} : { chrome: options.chrome }),
    ...(options.landmark === undefined ? {} : { landmark: options.landmark }),
    ...(options.headingLevel === undefined ? {} : { headingLevel: options.headingLevel }),
    ...(options.marking === undefined ? {} : { marking: options.marking }),
  });
  const ui = host.shadowRoot as ShadowRoot;
  return { ...setup, client: shown, page: host, ui, mounted, started, definition, hostSession };
}

type Shell = Awaited<ReturnType<typeof shell>>;

const buttons = (ui: ShadowRoot): string[] =>
  [...ui.querySelectorAll(".ak-actions button")].map((button) => button.textContent?.trim() ?? "");
const buttonNamed = (ui: ShadowRoot, name: string): HTMLButtonElement => {
  const found = [...ui.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
  if (found === undefined) throw new Error(`The page has no button ${JSON.stringify(name)}.`);
  return found;
};
const heading = (ui: ShadowRoot): HTMLElement => ui.querySelector(".ak-heading") as HTMLElement;
const contentOf = (ui: ShadowRoot): ShadowRoot =>
  (ui.querySelector(".ak-content-host") as HTMLElement).shadowRoot as ShadowRoot;
const statusOf = (ui: ShadowRoot): string => ui.querySelector(".ak-status")?.textContent ?? "";
const timerStatusOf = (ui: ShadowRoot): string => ui.querySelector(".ak-timer-status")?.textContent ?? "";
const dialogOf = (ui: ShadowRoot): HTMLDialogElement | null => ui.querySelector("dialog.ak-confirm");

/** Waits until the content of the first item is on screen. */
const shown = (s: Shell): Promise<void> =>
  waitFor(() => expect(contentOf(s.ui).querySelector(".ak-body")?.textContent).toContain("Look at"));

const answer = (identifier: string): CandidateAction => ({
  type: "set-responses",
  item: Q1,
  responses: new Map([["RESPONSE", single("identifier", identifier)]]),
});

describe("mountDelivery", () => {
  it("shows the rubric of the test, the item with its stimuli and the heading of the item, and keeps the rubric on every item", async () => {
    const s = await shell();
    await shown(s);
    expect(heading(s.ui).textContent).toBe("Item q1");
    const root = contentOf(s.ui);
    expect(root.querySelector(".ak-rubric")?.textContent).toContain("Read every question.");
    expect(root.querySelector(".ak-body img")?.getAttribute("src")).toBe(s.client.assets("items/q1/images/map.png"));
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    await waitFor(() =>
      expect(contentOf(s.ui).querySelector(".ak-rubric")?.textContent).toContain("Read every question."),
    );
  });

  it("lists the items of the part with their state, marks the current one and moves to the one the candidate chooses", async () => {
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
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    expect(s.ui.querySelector("nav [aria-current]")?.textContent).toContain("Item q2");
  });

  describe("Mark for review", () => {
    const mark = (ui: ShadowRoot): HTMLButtonElement => buttonNamed(ui, "Mark for review");
    const mapOf = (ui: ShadowRoot): string[] =>
      [...ui.querySelectorAll("nav button")].map((button) => button.textContent ?? "");

    it("offers no button unless the host asks for marking", async () => {
      const s = await shell();
      await shown(s);
      expect(buttons(s.ui)).not.toContain("Mark for review");
    });

    it("marks the item presented with a toggle that is pressed while it is marked, and names the mark in the map", async () => {
      const s = await shell({ marking: true });
      await shown(s);
      expect(mark(s.ui).getAttribute("aria-pressed")).toBe("false");
      mark(s.ui).click();
      await waitFor(() => expect(mark(s.ui).getAttribute("aria-pressed")).toBe("true"));
      expect(mapOf(s.ui)).toEqual([
        "Item q1 (In progress, Marked for review)",
        "Item q2 (Not started)",
        "Item q3 (Not started)",
      ]);
      buttonNamed(s.ui, "Next").click();
      await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
      await waitFor(() => expect(mark(s.ui).getAttribute("aria-pressed")).toBe("false"));
      expect(mapOf(s.ui)[0]).toBe("Item q1 (Paused, Marked for review)");
      buttonNamed(s.ui, "Previous").click();
      await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q1"));
      await waitFor(() => expect(mark(s.ui).getAttribute("aria-pressed")).toBe("true"));
      mark(s.ui).click();
      await waitFor(() => expect(mark(s.ui).getAttribute("aria-pressed")).toBe("false"));
      expect(mapOf(s.ui)[0]).toBe("Item q1 (In progress)");
    });

    it("keeps the focus on the toggle, and passes axe with and without a mark", async () => {
      const s = await shell({ marking: true });
      await shown(s);
      mark(s.ui).focus();
      mark(s.ui).click();
      await waitFor(() => expect(mark(s.ui).getAttribute("aria-pressed")).toBe("true"));
      expect(s.ui.activeElement).toBe(mark(s.ui));
      expect(await axeViolations(s.page)).toEqual([]);
      mark(s.ui).click();
      await waitFor(() => expect(mark(s.ui).getAttribute("aria-pressed")).toBe("false"));
      expect(await axeViolations(s.page)).toEqual([]);
    });

    it("shows a mark that the host made when it does not offer the button, and offers none in a linear part", async () => {
      const s = await shell();
      await shown(s);
      await s.client.dispatch({ type: "mark", item: Q1, marked: true });
      await waitFor(() => expect(mapOf(s.ui)[0]).toBe("Item q1 (In progress, Marked for review)"));
      expect(buttons(s.ui)).not.toContain("Mark for review");
      const linear = await shell({
        files: examFiles({ part: 'navigation-mode="linear" submission-mode="individual"' }),
        marking: true,
      });
      await shown(linear);
      expect(buttons(linear.ui)).not.toContain("Mark for review");
    });

    it("names the button and the mark in Indonesian", async () => {
      const s = await shell({ marking: true, language: "id" });
      await waitFor(() => expect(buttonNamed(s.ui, "Tandai untuk ditinjau")).toBeTruthy());
      buttonNamed(s.ui, "Tandai untuk ditinjau").click();
      await waitFor(() => expect(mapOf(s.ui)[0]).toContain("Ditandai untuk ditinjau"));
    });
  });

  it("moves forward only in a linear part: no way back, and the items behind are out of reach", async () => {
    const s = await shell({ files: examFiles({ part: 'navigation-mode="linear" submission-mode="individual"' }) });
    await shown(s);
    expect(s.ui.querySelector("nav")).toBeNull();
    expect(buttons(s.ui)).not.toContain("Previous");
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    const nav = [...s.ui.querySelectorAll<HTMLButtonElement>("nav button")];
    expect(nav.map((button) => [button.textContent, button.disabled])).toEqual([
      ["Item q1 (Submitted)", true],
      ["Item q2 (In progress)", false],
    ]);
    expect(buttons(s.ui)).not.toContain("Previous");
  });

  it("moves the focus to the heading of the item when the item changes, and not when the player starts", async () => {
    const s = await shell();
    await shown(s);
    expect(s.ui.activeElement).toBeNull();
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    expect(s.ui.activeElement).toBe(heading(s.ui));
  });

  it("keeps the focus on the control that has it when a new view arrives, and moves it to the heading when that control is gone", async () => {
    const s = await shell();
    await shown(s);
    const submit = buttonNamed(s.ui, "Submit answer");
    submit.focus();
    expect(s.ui.activeElement).toBe(submit);
    await s.client.dispatch(answer("A"));
    await waitFor(() => expect(s.ui.activeElement?.textContent).toBe("Submit answer"));
    submit.click();
    await waitFor(() => expect(buttons(s.ui)).not.toContain("Submit answer"));
    expect(s.ui.activeElement).toBe(heading(s.ui));
  });

  it("draws a button for each action of the view, and none for the pause that an exam does not allow", async () => {
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
    expect(s.ui.querySelector(".ak-actions")?.getAttribute("aria-label")).toBe("Actions");
  });

  it("lets the candidate pause and resume in practice, where the engine runs on the device", async () => {
    const s = await shell({ practice: true });
    await shown(s);
    expect(buttons(s.ui)).toContain("Pause the test");
    buttonNamed(s.ui, "Pause the test").click();
    await waitFor(() => expect(buttons(s.ui)).toEqual(["Resume the test"]));
    expect(s.ui.querySelector(".ak-notice")?.textContent).toBe(
      "The test is paused and your time is stopped. Wait until it continues.",
    );
    buttonNamed(s.ui, "Resume the test").click();
    await waitFor(() => expect(buttons(s.ui)).toContain("Submit answer"));
    expect(s.ui.querySelector(".ak-notice")).toBeNull();
  });

  it("says in words why the engine refused, in the status region and without moving the focus", async () => {
    const s = await shell({ files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await shown(s);
    const submit = buttonNamed(s.ui, "Submit answer");
    submit.focus();
    s.clock.advance(700 * SECOND);
    submit.click();
    await waitFor(() => expect(statusOf(s.ui)).toBe("The time for this question is over."));
    const region = s.ui.querySelector(".ak-status");
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(s.ui.activeElement?.textContent).not.toBe("");
  });

  it("writes the interface in the language of the candidate, the refusals included", async () => {
    const s = await shell({ language: "id", files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await shown(s);
    expect(s.ui.querySelector(".ak-player")?.getAttribute("lang")).toBe("id");
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
    await waitFor(() => expect(statusOf(s.ui)).toBe("Waktu untuk soal ini sudah habis."));
  });

  it("asks before the end of the test, starts on the answer that goes back, and sends nothing when the candidate goes back", async () => {
    const s = await shell();
    await shown(s);
    const version = s.store.records.get("exam-1")?.version;
    const end = buttonNamed(s.ui, "End the test");
    end.focus();
    end.click();
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    const dialog = dialogOf(s.ui) as HTMLDialogElement;
    expect(dialog.getAttribute("aria-label")).toBe("Please confirm");
    expect(dialog.querySelector("p")?.textContent).toBe(
      "End the test? Your answers are submitted and you cannot change them.",
    );
    expect(s.ui.activeElement?.textContent).toBe("No, go back");
    dialog.dispatchEvent(new Event("cancel"));
    dialog.close();
    await waitFor(() => expect(dialogOf(s.ui)).toBeNull());
    expect(s.ui.activeElement).toBe(end);
    expect(s.store.records.get("exam-1")?.version).toBe(version);
  });

  it("ends the test when the candidate confirms, and tells that it ended", async () => {
    const s = await shell();
    await shown(s);
    buttonNamed(s.ui, "End the test").click();
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    buttonNamed(s.ui, "Yes, continue").click();
    await waitFor(() => expect(s.ui.querySelector(".ak-notice")?.textContent).toBe("The test has ended."));
    expect(buttons(s.ui)).toEqual([]);
    expect(s.ui.activeElement).toBe(heading(s.ui));
  });

  it("asks before a submit in a linear part, and not in a nonlinear one", async () => {
    const linear = await shell({ files: examFiles({ part: 'navigation-mode="linear" submission-mode="individual"' }) });
    await shown(linear);
    buttonNamed(linear.ui, "Submit answer").click();
    await waitFor(() => expect(dialogOf(linear.ui)?.open).toBe(true));
    expect(dialogOf(linear.ui)?.querySelector("p")?.textContent).toBe(
      "Submit your answer? You cannot change it afterward.",
    );
    buttonNamed(linear.ui, "Yes, continue").click();
    await waitFor(() => expect(buttons(linear.ui)).not.toContain("Submit answer"));
    const nonlinear = await shell();
    await shown(nonlinear);
    buttonNamed(nonlinear.ui, "Submit answer").click();
    await waitFor(() => expect(buttons(nonlinear.ui)).not.toContain("Submit answer"));
    expect(dialogOf(nonlinear.ui)).toBeNull();
  });

  it("warns how many questions are not submitted when a part ends, and that a simultaneous part submits them together", async () => {
    const s = await shell({ files: examFiles({ part: 'navigation-mode="nonlinear" submission-mode="simultaneous"' }) });
    await shown(s);
    buttonNamed(s.ui, "End this part").click();
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    const sentences = [...(dialogOf(s.ui)?.querySelectorAll("p") ?? [])].map((p) => p.textContent);
    expect(sentences).toEqual([
      "End this part of the test? You cannot return to it.",
      "The answers to all the questions of this part are submitted together when you end it.",
      "Questions not yet submitted: 1",
    ]);
  });

  it("counts the time left down, announces it five minutes and one minute before the limit and when it is over, and learns of the time-out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const s = await shell({ files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await vi.advanceTimersByTimeAsync(0);
    await real(150);
    const timer = () => s.ui.querySelector(".ak-timers")?.textContent;
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
    expect(s.ui.querySelector(".ak-timer-status")?.getAttribute("role")).toBe("status");
    await tick(60);
    expect(timerStatusOf(s.ui)).toBe("Time is up.");
    await waitFor(() => expect(s.ui.querySelector(".ak-nav-item")?.textContent).toContain("(Submitted)"));
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
  });

  it("tells the candidate who reloads inside the last minutes how much time is left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const s = await shell({ files: examFiles({ limits: '<qti-time-limits max-time="200"/>' }) });
    await vi.advanceTimersByTimeAsync(60);
    expect(timerStatusOf(s.ui)).toBe("Time left: 3 minutes 20 seconds");
  });

  it("lets the candidate hide the timers, and still announces the warnings", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const s = await shell({ files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await vi.advanceTimersByTimeAsync(0);
    await real(100);
    const list = s.ui.querySelector<HTMLElement>(".ak-timer-list");
    expect(list?.hidden).toBe(false);
    buttonNamed(s.ui, "Hide the timers").click();
    expect(list?.hidden).toBe(true);
    expect(buttonNamed(s.ui, "Show the timers")).toBeDefined();
    s.clock.advance(301 * SECOND);
    await vi.advanceTimersByTimeAsync(1100);
    expect(timerStatusOf(s.ui)).toBe("Time left: 4 minutes 59 seconds");
  });

  it("shows the time before the candidate may leave, and that a limit has passed and still takes answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const part = 'navigation-mode="linear" submission-mode="individual"';
    const minimum = await shell({ files: examFiles({ part, limits: '<qti-time-limits min-time="30"/>' }) });
    await vi.advanceTimersByTimeAsync(0);
    await real(150);
    expect(minimum.ui.querySelector(".ak-timers")?.textContent).toContain("Time before you may leave: 0:30");
    const late = await shell({
      files: examFiles({ limits: '<qti-time-limits max-time="60" allow-late-submission="true"/>' }),
    });
    await vi.advanceTimersByTimeAsync(0);
    await real(150);
    late.clock.advance(61 * SECOND);
    await vi.advanceTimersByTimeAsync(61 * SECOND);
    await real(150);
    expect(late.ui.querySelector(".ak-timers")?.textContent).toContain("Time is up. Answers are still accepted late.");
    expect(buttons(late.ui)).toContain("Submit answer");
  });

  it("shows the time-out that the host applied when the candidate acts after it", async () => {
    const s = await shell({ files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await shown(s);
    s.clock.advance(601 * SECOND);
    expect((await s.host.session(ALICE.session).apply({ type: "time" })).refusal).toBeUndefined();
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(s.ui.querySelector(".ak-nav-item")?.textContent).toContain("(Submitted)"));
  });

  it("offers the review and the solution of a closed item", async () => {
    const control = '<qti-item-session-control allow-review="true" show-solution="true"/>';
    const s = await shell({ files: examFiles({ control }) });
    await shown(s);
    buttonNamed(s.ui, "Submit answer").click();
    await waitFor(() => expect(buttons(s.ui)).toContain("Review answer"));
    expect(buttons(s.ui)).toContain("Show solution");
    buttonNamed(s.ui, "Review answer").click();
    await waitFor(() => expect(s.ui.querySelector(".ak-nav-item")?.textContent).toContain("(In review)"));
    buttonNamed(s.ui, "Show solution").click();
    await waitFor(() => expect(s.ui.querySelector(".ak-nav-item")?.textContent).toContain("(Solution shown)"));
  });

  it("draws a comment box where the item allows a comment, and sends the comment", async () => {
    const withoutComment = await shell();
    await shown(withoutComment);
    expect(withoutComment.ui.querySelector<HTMLElement>(".ak-comment")?.hidden).toBe(true);
    const s = await shell({ files: examFiles({ control: '<qti-item-session-control allow-comment="true"/>' }) });
    await shown(s);
    const form = s.ui.querySelector<HTMLFormElement>(".ak-comment");
    expect(form?.hidden).toBe(false);
    const field = form?.querySelector("textarea") as HTMLTextAreaElement;
    expect(form?.querySelector("label")?.getAttribute("for")).toBe(field.id);
    expect(form?.querySelector("label")?.textContent).toBe("Comment on this question");
    field.value = "Unclear wording.";
    buttonNamed(s.ui, "Save comment").click();
    await waitFor(() => expect(statusOf(s.ui)).toBe("Comment saved."));
    await s.client.dispatch({ type: "move", to: "next" });
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    expect(form?.hidden).toBe(true);
  });

  it("marks an item that depends on time", async () => {
    const files = { ...examFiles() };
    files["items/q2/item.xml"] = String(files["items/q2/item.xml"]).replace(
      'time-dependent="false"',
      'time-dependent="true"',
    );
    const s = await shell({ files });
    await shown(s);
    expect(s.ui.querySelector(".ak-notice")).toBeNull();
    buttonNamed(s.ui, "Next").click();
    await waitFor(() =>
      expect(s.ui.querySelector(".ak-notice")?.textContent).toBe(
        "This question is timed. Your time counts while you work on it.",
      ),
    );
  });

  it("tells how many attempts the candidate has used and has left", async () => {
    const control = '<qti-item-session-control max-attempts="2" show-feedback="true"/>';
    const s = await shell({ files: examFiles({ control }) });
    await shown(s);
    expect(s.ui.querySelector(".ak-attempts")?.textContent).toBe("Attempts used: 1. Attempts left: 2");
  });

  it("shows a break that the proctor made, and the candidate can do nothing until the proctor ends it", async () => {
    const s = await shell();
    await shown(s);
    expect((await s.host.proctor(ALICE.session, { type: "suspend" })).refusal).toBeUndefined();
    buttonNamed(s.ui, "Skip question").click();
    await waitFor(() => expect(statusOf(s.ui)).toBe("The test is paused, so this action is not possible."));
    expect(s.ui.querySelector(".ak-notice")?.textContent).toBe(
      "The test is paused and your time is stopped. Wait until it continues.",
    );
    expect(buttons(s.ui)).toEqual([]);
    expect((await s.host.proctor(ALICE.session, { type: "resume" })).refusal).toBeUndefined();
    s.mounted.destroy();
    const reloaded = createRemoteSession(
      async (envelope) => JSON.parse(JSON.stringify(await s.host.handle(ALICE, JSON.parse(JSON.stringify(envelope))))),
      JSON.parse(JSON.stringify(await s.host.view(ALICE))),
      { clock: s.clock },
    );
    expect(reloaded.view.status).toBe("in-progress");
    reloaded.close();
  });

  it("mounts a session that the store restored, where the candidate left it", async () => {
    const s = await shell();
    await shown(s);
    await s.client.dispatch({ type: "move", to: "next" });
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
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
        ...NO_RECORDING,
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

  it("announces the result of an action in a status region and not in the focus", async () => {
    const s = await shell({ files: examFiles({ control: '<qti-item-session-control allow-comment="true"/>' }) });
    await shown(s);
    const field = s.ui.querySelector("textarea") as HTMLTextAreaElement;
    field.focus();
    field.value = "Fine.";
    buttonNamed(s.ui, "Save comment").click();
    await waitFor(() => expect(statusOf(s.ui)).toBe("Comment saved."));
    expect(s.ui.activeElement).toBe(field);
    for (const selector of [".ak-status", ".ak-timer-status"]) {
      const region = s.ui.querySelector(selector);
      expect(region?.getAttribute("role"), selector).toBe("status");
      expect(region?.getAttribute("aria-atomic"), selector).toBe("true");
    }
  });

  it("says that the answers could not be sent, and that they were rejected", async () => {
    const failing = await shell({
      wrap: (client) =>
        ({ ...client, dispatch: async () => Promise.reject(new TypeError("Failed to fetch")) }) as never,
    });
    await shown(failing);
    const ignore = (event: ErrorEvent): void => event.preventDefault();
    window.addEventListener("error", ignore);
    try {
      buttonNamed(failing.ui, "Skip question").click();
      await waitFor(() =>
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
    await waitFor(() => expect(statusOf(rejecting.ui)).toBe("The test could not accept this action."));
  });

  it("draws the content alone when the host draws the chrome", async () => {
    const s = await shell({ chrome: false });
    await shown(s);
    expect(s.ui.querySelector(".ak-actions button")).toBeNull();
    expect(s.ui.querySelector("nav")).toBeNull();
    expect(s.ui.querySelector(".ak-timers")).toBeNull();
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

  it("aborts the stylesheets that are still loading when the player is destroyed, and reports nothing after", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const errors: unknown[] = [];
    const heard: unknown[] = [];
    const listen = (event: ErrorEvent): void => void heard.push(event.error);
    window.addEventListener("error", listen);
    try {
      const s = await shell({
        onError: (error) => void errors.push(error),
        fetch: (_url, request) => {
          signals.push(request.signal);
          return new Promise((_resolve, reject) =>
            request.signal?.addEventListener("abort", () => reject(new DOMException("Aborted.", "AbortError"))),
          );
        },
      });
      await waitFor(() => expect(signals.length).toBeGreaterThan(0));
      expect(signals.every((signal) => signal?.aborted === false)).toBe(true);
      s.mounted.destroy();
      expect(signals.every((signal) => signal?.aborted === true)).toBe(true);
      // The failures arrive after the destroy: wait for the page to settle by round trips through the event loop.
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(null);
      });
      expect(errors).toEqual([]);
      expect(heard).toEqual([]);
    } finally {
      window.removeEventListener("error", listen);
    }
  });

  it("gives the errors that it can only report to the hook onError, while the player is mounted", async () => {
    const errors: unknown[] = [];
    const s = await shell({
      onError: (error) => void errors.push(error),
      fetch: async () => ({ ok: false, status: 403, text: async () => "" }),
    });
    await waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(String(errors[0])).toContain("could not be fetched: HTTP 403");
    s.mounted.destroy();
  });

  it("holds the player in a region named by a heading of level 2, so that it fits in a page that has a main of its own", async () => {
    const s = await shell();
    expect(s.ui.querySelector("main")).toBeNull();
    const region = s.ui.querySelector<HTMLElement>("section.ak-main");
    const title = s.ui.querySelector<HTMLElement>(".ak-heading");
    expect(title?.tagName).toBe("H2");
    expect(region?.getAttribute("aria-labelledby")).toBe(title?.id);
    expect(title?.id).not.toBe("");
  });

  it("holds the player in the main landmark under a heading of level 1 when the page is the player", async () => {
    const s = await shell({ landmark: "main", headingLevel: 1 });
    expect(s.ui.querySelector("main.ak-main")).not.toBeNull();
    expect(s.ui.querySelector("section.ak-main")).toBeNull();
    expect(s.ui.querySelector(".ak-heading")?.tagName).toBe("H1");
  });

  it("marks the item presented with a shape, so that no glyph enters the name of its button", async () => {
    const s = await shell();
    const current = s.ui.querySelector<HTMLElement>('.ak-nav-item[aria-current="true"]');
    expect(current).not.toBeNull();
    const marker = getComputedStyle(current as HTMLElement, "::before");
    expect(marker.content).toBe('""');
    expect(marker.borderLeftWidth).not.toBe("0px");
    expect(current?.textContent).not.toContain("\u25B6");
  });

  /** The options of a second mount over the session of a shell. */
  const remountOptions = (s: Shell) => ({
    client: s.client,
    files: {
      upload: async () => ({ reference: "f", mimeType: "x" }),
      read: async () => new Uint8Array(),
      url: () => "",
      ...NO_RECORDING,
    },
    staticUrl: "https://s.example/",
    stylesheet: player,
    fetch: async () => ({ ok: true, status: 200, text: async () => "" }),
  });

  it("mounts again on the element of a player that was destroyed, as a page that switches sessions does", async () => {
    const s = await shell();
    expect(() => mountDelivery(s.page, remountOptions(s))).toThrow(HOST_SHADOW_RULE);
    s.mounted.destroy();
    expect(s.page.shadowRoot?.childNodes.length).toBe(0);
    const again = mountDelivery(s.page, remountOptions(s));
    expect(s.page.shadowRoot).toBe(s.ui);
    await waitFor(() => expect(s.ui.querySelector(".ak-heading")?.textContent).toBe("Item q1"));
    again.destroy();
  });

  it("needs reserve and fill to record, and asks for neither when the recording is off", async () => {
    const s = await shell();
    const bare = {
      upload: async () => ({ reference: "f", mimeType: "x" }),
      read: async () => new Uint8Array(),
      url: () => "",
    };
    const options = {
      client: s.client,
      staticUrl: "https://s.example/",
      stylesheet: player,
      fetch: async () => ({ ok: true, status: 200, text: async () => "" }),
    };
    const fresh = (): HTMLElement => {
      const host = document.createElement("div");
      document.body.append(host);
      hosts.push(host);
      return host;
    };
    expect(() => mountDelivery(fresh(), { ...options, files: bare })).toThrow(
      "The function reserve of the option files",
    );
    expect(() => mountDelivery(fresh(), { ...options, files: { ...bare, reserve: NO_RECORDING.reserve } })).toThrow(
      "The function fill of the option files",
    );
    mountDelivery(fresh(), { ...options, files: bare, hooks: { record: false } }).destroy();
  });

  it("checks its arguments", async () => {
    const s = await shell();
    const options = {
      client: s.client,
      files: {
        upload: async () => ({ reference: "f", mimeType: "x" }),
        read: async () => new Uint8Array(),
        url: () => "",
        ...NO_RECORDING,
      },
      staticUrl: "https://s.example/",
      stylesheet: player,
      fetch: async () => ({ ok: true, status: 200, text: async () => "" }),
    };
    const fresh = (): HTMLElement => document.createElement("div");
    const mount = (host: unknown, changes: Record<string, unknown> = {}): unknown =>
      mountDelivery(host as HTMLElement, { ...options, ...changes });
    expect(() => mount(null)).toThrow("The host must be an element, found null.");
    expect(() => mount(s.page)).toThrow(HOST_SHADOW_RULE);
    expect(() => mount(fresh(), { staticUrl: "https://s.example" })).toThrow('The option staticUrl must end in "/"');
    expect(() => mount(fresh(), { stylesheet: "css" })).toThrow("The option stylesheet must be a CSSStyleSheet");
    expect(() => mount(fresh(), { fetch: null })).toThrow("The option fetch must be a function");
    expect(() => mount(fresh(), { files: { upload: 1 } })).toThrow("The function upload of the option files");
    expect(() => mount(fresh(), { language: "" })).toThrow("The option language must be a non-empty string");
    expect(() => mount(fresh(), { origins: ["ftp://x"] })).toThrow("An origin of the option origins");
    expect(() => mount(fresh(), { chrome: "yes" })).toThrow("The option chrome must be a boolean");
    expect(() => mount(fresh(), { landmark: "page" })).toThrow('The option landmark must be "main" or "region"');
    expect(() => mount(fresh(), { headingLevel: 7 })).toThrow("The option headingLevel must be from 1 to 6, found 7.");
    expect(() => mount(fresh(), { headingLevel: "2" })).toThrow("The option headingLevel must be a positive integer");
    expect(() => mount(fresh(), { resumeCheckMs: -1 })).toThrow(
      "The option resumeCheckMs must be a non-negative integer",
    );
    expect(() => mount(fresh(), { resumeCheckMs: "30" })).toThrow(
      "The option resumeCheckMs must be a non-negative integer",
    );
    expect(() => mount(fresh(), { hooks: { voice: {} } })).toThrow("The method speak of the hook voice");
    expect(() => mount(fresh(), { hooks: { voice: "robot" } })).toThrow("The hook voice must be an object");
    expect(() => mount(fresh(), { hooks: { tools: { dictionary: 1 } } })).toThrow(
      "The tool dictionary of the hook tools must be a function",
    );
    expect(() => mount(fresh(), { hooks: { tools: { abacus: () => undefined } } })).toThrow(
      "The hook tools has the properties",
    );
    expect(() => mount(fresh(), { hooks: { tools: [] } })).toThrow("The hook tools must be an object");
    expect(() => mount(fresh(), { client: {} })).toThrow("The function age of the option client");
    expect(() => mount(fresh(), { other: 1 })).toThrow("The options has the properties");
  });
});

describe("a review after the end in the player", () => {
  /** Answers the first item, moves to the second, and ends the test through the buttons. */
  async function sat(options: { readonly practice?: boolean } = {}): Promise<Shell> {
    const s = await shell({ ...options, reviewAfterEnd: true });
    await shown(s);
    await s.client.dispatch(answer("B"));
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    buttonNamed(s.ui, "End the test").click();
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    buttonNamed(s.ui, "Yes, continue").click();
    await waitFor(() => expect(s.ui.querySelector(".ak-notice")?.textContent).toBe("The test has ended."));
    return s;
  }

  const entries = (s: Shell): string[] =>
    [...s.ui.querySelectorAll(".ak-nav button")].map((button) => button.textContent?.trim() ?? "");

  it("lists the questions that were presented once the test ended, and shows the one that the candidate chooses as sat", async () => {
    for (const practice of [false, true]) {
      const s = await sat({ practice });
      expect(entries(s)).toEqual(["Item q1 (Submitted)", "Item q2 (Submitted)"]);
      expect(s.client.view.current).toBeUndefined();
      expect(buttons(s.ui)).toEqual([]);
      const first = [...s.ui.querySelectorAll<HTMLButtonElement>(".ak-nav button")][0] as HTMLButtonElement;
      first.click();
      await waitFor(() => expect(s.client.view.current?.key.ref).toBe("q1"));
      expect(s.client.view.status).toBe("ended");
      expect(s.client.view.current?.status).toBe("review");
      await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q1"));
      await waitFor(() =>
        expect(
          [...contentOf(s.ui).querySelectorAll<HTMLInputElement>("input.ak-control")].map((input) => input.checked),
        ).toEqual([false, true]),
      );
      expect(s.ui.querySelector(".ak-notice")?.textContent).toBe("The test has ended.");
      expect(entries(s)).toEqual(["Item q1 (In review)", "Item q2 (Submitted)"]);
    }
  });

  it("leaves the answers as they were: the choices are fixed and the view of the other question shows its own", async () => {
    const s = await sat();
    ([...s.ui.querySelectorAll<HTMLButtonElement>(".ak-nav button")][1] as HTMLButtonElement).click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    const inputs = [...contentOf(s.ui).querySelectorAll<HTMLInputElement>("input.ak-control")];
    expect(inputs.map((input) => [input.checked, input.disabled])).toEqual([
      [false, true],
      [false, true],
    ]);
    const results = await s.host.session(ALICE.session).results();
    expect(results.itemResults.map(({ identifier, sessionStatus }) => [identifier, sessionStatus])).toEqual([
      ["q1", "final"],
      ["q2", "final"],
      ["q3", "initial"],
    ]);
  });

  it("has no accessibility violations while a question is reviewed", async () => {
    const s = await sat();
    ([...s.ui.querySelectorAll<HTMLButtonElement>(".ak-nav button")][0] as HTMLButtonElement).click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q1"));
    expect(await axeViolations(s.page)).toEqual([]);
  });

  it("shows no map and no button after the end when the engine does not allow a review", async () => {
    const s = await shell();
    await shown(s);
    buttonNamed(s.ui, "End the test").click();
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    buttonNamed(s.ui, "Yes, continue").click();
    await waitFor(() => expect(s.ui.querySelector(".ak-notice")?.textContent).toBe("The test has ended."));
    expect(entries(s)).toEqual([]);
    expect(buttons(s.ui)).toEqual([]);
  });
});

describe("a portable custom interaction in the player", () => {
  it("stores the response and the state of the interaction with the session, so that it restores on another device", async () => {
    const s = await shell({
      files: pciFiles(),
      wrap: (client) =>
        Object.create(client, { assets: { value: (path: string) => `${inject("fixtures").asset}/g/pci/${path}` } }),
    });
    // The interaction's files come from the fixtures server: the player fetches its module resolution through `fetch`.
    await shown(s);
    await s.client.dispatch({ type: "move", to: { ref: "q3", instance: 1 } });
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q3"));
    await waitFor(() => expect(contentOf(s.ui).querySelector("iframe")).not.toBeNull());
    await waitFor(
      async () => {
        await commands.clickInFrame("Press the button", "#press");
      },
      { timeout: 15_000 },
    );
    await waitFor(
      () => {
        const stored = s.store.records.get("exam-1");
        expect(stored?.version).toBeGreaterThan(1);
      },
      { timeout: 15_000 },
    );
    const view = s.client.view.current;
    await waitFor(() => expect(statusOf(s.ui)).toBe("Answers saved."));
    await waitFor(() => expect(s.client.view.current?.responses.get("PCI")).toBeDefined());
    expect(s.client.view.current?.responses.get("PCI")).toEqual(single("integer", 1));
    expect(s.client.view.current?.pci.get("PCI")?.state).toBe('{"count":1}');
    expect(view?.key.ref).toBe("q3");
  });
});

/** The radio buttons of the choice interaction of the item shown, in the order of the choices. */
const choices = (ui: ShadowRoot): HTMLInputElement[] => [
  ...contentOf(ui).querySelectorAll<HTMLInputElement>("qti-choice-interaction input.ak-control"),
];

describe("the interactions in the player", () => {
  it("sends the response that the candidate gives, and tells that the answers are saved", async () => {
    const s = await shell();
    await waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    choices(s.ui)[1]?.click();
    await waitFor(() => expect(statusOf(s.ui)).toBe("Answers saved."));
    expect(s.client.view.current?.responses.get("RESPONSE")).toEqual(single("identifier", "B"));
    expect(choices(s.ui).map((input) => input.checked)).toEqual([false, true]);
  });

  it("keeps what the candidate chose when a view that answers an earlier request arrives", async () => {
    const s = await shell();
    await waitFor(() => expect(choices(s.ui)).toHaveLength(2));
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

  it("sends the held response before the submit, so that the engine submits what the candidate chose", async () => {
    const control = '<qti-item-session-control allow-review="true" show-solution="true"/>';
    const s = await shell({ files: examFiles({ control }) });
    await waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    choices(s.ui)[1]?.click();
    buttonNamed(s.ui, "Submit answer").click();
    await waitFor(() => expect(buttons(s.ui)).toContain("Review answer"));
    expect(s.client.view.current?.responses.get("RESPONSE")).toEqual(single("identifier", "B"));
  });

  it("disables the interactions of a closed item, and shows the answer in the review and the correct one in the solution", async () => {
    const control = '<qti-item-session-control allow-review="true" show-solution="true"/>';
    const s = await shell({ files: examFiles({ control }) });
    await waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    expect(choices(s.ui).map((input) => input.disabled)).toEqual([false, false]);
    choices(s.ui)[1]?.click();
    buttonNamed(s.ui, "Submit answer").click();
    await waitFor(() => expect(buttons(s.ui)).toContain("Review answer"));
    await waitFor(() => expect(choices(s.ui).map((input) => input.disabled)).toEqual([true, true]));
    expect(choices(s.ui).map((input) => input.checked)).toEqual([false, true]);
    buttonNamed(s.ui, "Review answer").click();
    await waitFor(() => expect(s.ui.querySelector(".ak-nav-item")?.textContent).toContain("(In review)"));
    await waitFor(() => expect(choices(s.ui).map((input) => input.disabled)).toEqual([true, true]));
    expect(choices(s.ui).map((input) => input.checked)).toEqual([false, true]);
    buttonNamed(s.ui, "Show solution").click();
    await waitFor(() => expect(s.ui.querySelector(".ak-nav-item")?.textContent).toContain("(Solution shown)"));
    await waitFor(() => expect(choices(s.ui).map((input) => input.checked)).toEqual([true, false]));
    expect(choices(s.ui).map((input) => input.disabled)).toEqual([true, true]);
  });
});

describe("accessibility of the chrome", () => {
  it("has no violation of WCAG 2.2 A and AA when it runs, asks, pauses and ends", async () => {
    const s = await shell({ practice: true, files: examFiles({ limits: '<qti-time-limits max-time="600"/>' }) });
    await shown(s);
    expect(await axeViolations(s.page)).toEqual([]);
    buttonNamed(s.ui, "End the test").click();
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    expect(await axeViolations(s.page)).toEqual([]);
    buttonNamed(s.ui, "No, go back").click();
    await waitFor(() => expect(dialogOf(s.ui)).toBeNull());
    buttonNamed(s.ui, "Pause the test").click();
    await waitFor(() => expect(buttons(s.ui)).toEqual(["Resume the test"]));
    expect(await axeViolations(s.page)).toEqual([]);
    buttonNamed(s.ui, "Resume the test").click();
    await waitFor(() => expect(buttons(s.ui)).toContain("End the test"));
    buttonNamed(s.ui, "End the test").click();
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    buttonNamed(s.ui, "Yes, continue").click();
    await waitFor(() => expect(s.ui.querySelector(".ak-notice")?.textContent).toBe("The test has ended."));
    expect(await axeViolations(s.page)).toEqual([]);
  });

  it("is operated with the keyboard alone: the map comes before the actions, and Enter and Space press a button", async () => {
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
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    buttonNamed(s.ui, "Previous").focus();
    await userEvent.keyboard(" ");
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q1"));
  });

  it("gives the focus to the answer that goes back, and back to the control that asked", async () => {
    const s = await shell();
    await shown(s);
    const end = buttonNamed(s.ui, "End this part");
    end.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    expect(s.ui.activeElement?.textContent).toBe("No, go back");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialogOf(s.ui)).toBeNull());
    expect(s.ui.activeElement).toBe(end);
    end.click();
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    const yes = buttonNamed(s.ui, "Yes, continue");
    expect(yes.tabIndex).toBeGreaterThanOrEqual(0);
    yes.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(dialogOf(s.ui)).toBeNull());
    await waitFor(() => expect(s.ui.querySelector(".ak-notice")?.textContent).toBe("The test has ended."));
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
  ...ui.querySelectorAll<HTMLButtonElement>(".ak-supports button"),
];
const contentHostOf = (ui: ShadowRoot): HTMLElement => ui.querySelector(".ak-content-host") as HTMLElement;

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
  it("draws a toggle button for each support that is an option, and none for a support that is on from the start or prohibited", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    const region = s.ui.querySelector(".ak-supports");
    expect(region?.getAttribute("aria-label")).toBe("Supports");
    expect(panelButtons(s.ui).map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([
      ["High contrast", "false"],
      ["Alternative text", "false"],
    ]);
  });

  it("has no panel for a candidate whose profile gives no option", async () => {
    const s = await shell();
    await shown(s);
    expect(s.ui.querySelector(".ak-supports")?.hasAttribute("hidden")).toBe(true);
    expect(panelButtons(s.ui).filter((button) => button.offsetParent !== null)).toEqual([]);
  });

  it("sends the support action through the session, applies the support to the next view and takes it off when pressed again", async () => {
    const { sent, wrap } = recording();
    const s = await shell({ profile: PROFILE, wrap });
    await shown(s);
    const host = contentHostOf(s.ui);
    expect(host.hasAttribute("data-ak-contrast")).toBe(false);
    buttonNamed(s.ui, "High contrast").click();
    await waitFor(() => expect(host.getAttribute("data-ak-contrast")).toBe("high"));
    expect(sent).toContainEqual({ type: "support", name: "high-contrast", active: true });
    expect(buttonNamed(s.ui, "High contrast").getAttribute("aria-pressed")).toBe("true");
    buttonNamed(s.ui, "High contrast").click();
    await waitFor(() => expect(host.hasAttribute("data-ak-contrast")).toBe(false));
    expect(sent).toContainEqual({ type: "support", name: "high-contrast", active: false });
    expect(buttonNamed(s.ui, "High contrast").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the focus on the button that turned a support, and says nothing in the status region", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    const button = buttonNamed(s.ui, "High contrast");
    button.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    expect(s.ui.activeElement).toBe(button);
    expect(statusOf(s.ui)).toBe("");
  });

  it("shows the alternative text of an image after the support is turned on, without drawing the content again", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    const body = contentOf(s.ui).querySelector(".ak-body");
    expect(contentOf(s.ui).querySelector(".ak-body")?.textContent).not.toContain("A map");
    buttonNamed(s.ui, "Alternative text").click();
    await waitFor(() => expect(contentOf(s.ui).querySelector(".ak-body")?.textContent).toContain("A map"));
    expect(contentOf(s.ui).querySelector(".ak-body")).toBe(body);
    buttonNamed(s.ui, "Alternative text").click();
    await waitFor(() => expect(contentOf(s.ui).querySelector(".ak-body")?.textContent).not.toContain("A map"));
  });

  it("leaves what the supports added alone while the answers are saved, and applies them again to the next item", async () => {
    const s = await shell({ profile: PROFILE });
    await waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    buttonNamed(s.ui, "Alternative text").click();
    await waitFor(() => expect(contentOf(s.ui).querySelector(".ak-body")?.textContent).toContain("A map"));
    const after = [...contentOf(s.ui).querySelectorAll("img + *")].find((node) => node.textContent === "A map");
    expect(after).toBeDefined();
    choices(s.ui)[1]?.click();
    await waitFor(() => expect(statusOf(s.ui)).toBe("Answers saved."));
    expect(after?.isConnected).toBe(true);
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    await waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    expect(buttonNamed(s.ui, "Alternative text").getAttribute("aria-pressed")).toBe("true");
  });

  it("applies a support that is on from the start, and draws no control for it", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    expect(contentHostOf(s.ui).hasAttribute("data-ak-single-column")).toBe(true);
    expect(panelButtons(s.ui).map((button) => button.textContent)).not.toContain("Single column");
  });

  it("lists the supports that are on from the start with their state, next to the buttons of the options", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    const lines = (): (string | null)[] =>
      [...s.ui.querySelectorAll(".ak-supports li")].map((line) => line.textContent);
    await waitFor(() => expect(lines()).toEqual(expect.arrayContaining(["Single column: on", "Spoken: on"])));
    expect(lines()).toEqual(expect.arrayContaining(["High contrast", "Alternative text"]));
    // The prohibited magnification is not listed, and the states have no control.
    expect(lines().join(" ")).not.toContain("Magnification");
    expect(s.ui.querySelector(".ak-supports li:not(:has(button))") === null).toBe(false);
    expect(panelButtons(s.ui).map((button) => button.textContent)).toEqual(["High contrast", "Alternative text"]);
  });

  it("applies the supports to the content when the host draws the chrome, and draws no panel", async () => {
    const s = await shell({ profile: PROFILE, chrome: false });
    await shown(s);
    expect(contentHostOf(s.ui).hasAttribute("data-ak-single-column")).toBe(true);
    expect(s.ui.querySelector(".ak-supports")).toBeNull();
  });

  it("names the supports in the language of the interface", async () => {
    const s = await shell({ profile: PROFILE, language: "id" });
    await waitFor(() => expect(panelButtons(s.ui)).toHaveLength(2));
    expect(s.ui.querySelector(".ak-supports")?.getAttribute("aria-label")).toBe(ID_MESSAGES.supportsLabel);
  });

  it("reads the content with the voice of the host when the profile asks for it", async () => {
    const requests: SpeechRequest[] = [];
    const voice = {
      speak: async (request: SpeechRequest): Promise<void> => void requests.push(request),
      stop: () => undefined,
    };
    const s = await shell({ profile: PROFILE, voice });
    await shown(s);
    await waitFor(() => expect(s.ui.querySelector(".ak-read-aloud")?.hasAttribute("hidden")).toBe(false));
    buttonNamed(s.ui, "Read aloud").click();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.text).toContain("Look at");
    expect(requests[0]?.lang).toBe("en");
  });

  it("changes the look inside the frame of a portable custom interaction when a support is turned on and off", async () => {
    const s = await shell({
      files: pciFiles(),
      profile: PROFILE,
      wrap: (client) =>
        Object.create(client, { assets: { value: (path: string) => `${inject("fixtures").asset}/g/pci/${path}` } }),
    });
    await shown(s);
    await s.client.dispatch({ type: "move", to: { ref: "q3", instance: 1 } });
    await waitFor(() => expect(contentOf(s.ui).querySelector("iframe")).not.toBeNull());
    const look = async () => (await commands.frameTheme("Press the button")).attributes["data-ak-contrast"];
    await waitFor(async () => expect(await look()).toBeUndefined(), { timeout: 15_000 });
    buttonNamed(s.ui, "High contrast").click();
    await waitFor(async () => expect(await look()).toBe("high"), { timeout: 15_000 });
    buttonNamed(s.ui, "High contrast").click();
    await waitFor(async () => expect(await look()).toBeUndefined(), { timeout: 15_000 });
  });

  it("says which version of the question was delivered", async () => {
    const s = await shell();
    await shown(s);
    const current = s.client.view.current;
    if (current === undefined) throw new Error("The fixture shows an item.");
    const notice = (): HTMLElement => s.ui.querySelector(".ak-variant") as HTMLElement;
    expect(notice().hidden).toBe(true);
    s.mounted.update({ ...s.client.view, current: { ...current, variant: { resource: "q1-id", language: "id" } } });
    await waitFor(() => expect(notice().textContent).toBe("Language of this version: Indonesian"));
    expect(notice().querySelector("span")?.getAttribute("lang")).toBe("id");
    s.mounted.update({ ...s.client.view, current });
    await waitFor(() => expect(notice().hidden).toBe(true));
  });

  it("has no violation of WCAG 2.2 A and AA with the panel and the controls of reading aloud", async () => {
    const s = await shell({ profile: PROFILE });
    await shown(s);
    await waitFor(() => expect(s.ui.querySelector(".ak-read-aloud")?.hasAttribute("hidden")).toBe(false));
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
function drawingFiles(prompt = "Draw."): Readonly<Record<string, string | Uint8Array>> {
  return {
    ...examFiles(),
    "items/q1/item.xml": `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="q1" title="Item q1" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="file"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>
  <qti-item-body>
    <p>Look at the picture.</p>
    <qti-drawing-interaction response-identifier="RESPONSE"><qti-prompt>${prompt}</qti-prompt><object type="image/png" width="200" height="100" data="${picture(200, 100, "#ffffff")}">A canvas</object></qti-drawing-interaction>
  </qti-item-body>
</qti-assessment-item>`,
  };
}

/**
 * A storage of drawings that keeps each upload pending until the test lets it go; a stored drawing plays back as a white
 * picture. After `finish` an upload that the drawing makes later is stored at once, so that no drawing waits for a test
 * that has gone on.
 */
function slowUpload(): {
  readonly files: Pick<Parameters<typeof shell>[0] & object, "upload" | "url">;
  /** Resolves when the drawing has asked to store its first picture. */
  readonly started: Promise<void>;
  readonly uploads: () => number;
  readonly finish: () => void;
} {
  const pending: (() => void)[] = [];
  const stored = picture(200, 100, "#ffffff");
  let started = (): void => undefined;
  const first = new Promise<void>((resolve) => {
    started = resolve;
  });
  let released = false;
  let count = 0;
  return {
    files: {
      upload: (_bytes, mimeType) =>
        new Promise((resolve) => {
          count += 1;
          const reference = `drawing-${count}`;
          const store = (): void => resolve({ reference, mimeType });
          if (released) store();
          else pending.push(store);
          started();
        }),
      url: () => stored,
    },
    started: first,
    uploads: () => count,
    finish: () => {
      released = true;
      for (const release of pending.splice(0)) release();
    },
  };
}

/** Draws a line, and returns once the drawing has asked to store the picture. */
async function draw(s: Shell, storage: ReturnType<typeof slowUpload>): Promise<void> {
  // The pen paints only once the picture has loaded and the stage has its size.
  const image = contentOf(s.ui).querySelector<HTMLImageElement>("qti-drawing-interaction .ak-stage img");
  await image?.decode();
  await settle();
  const target = contentOf(s.ui).querySelector<HTMLElement>(".ak-surface") as HTMLElement;
  await userEvent.dragAndDrop(target, target, { sourcePosition: { x: 20, y: 20 }, targetPosition: { x: 120, y: 20 } });
  await storage.started;
}

describe("a drawing that is still being stored", () => {
  const types = (sent: readonly CandidateAction[]): string[] => sent.map(({ type }) => type);

  it.each([
    ["submit", async (s: Shell) => buttonNamed(s.ui, "Submit answer").click(), "submit"],
    ["move to the next question", async (s: Shell) => buttonNamed(s.ui, "Next").click(), "move"],
    [
      "choose another question in the map",
      async (s: Shell) => (s.ui.querySelectorAll(".ak-nav-item")[1] as HTMLElement).click(),
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
      await waitFor(() => expect(types(sent)).toContain(type));
      expect(types(sent).filter((each) => each === "set-responses" || each === type)).toEqual(["set-responses", type]);
      const response = sent.find((action) => action.type === "set-responses");
      expect(response?.type === "set-responses" && response.responses.get("RESPONSE")).toMatchObject({
        cardinality: "single",
        baseType: "file",
        value: { reference: "drawing-1" },
      });
    },
  );

  it("sends the drawing before the end of the test, once the candidate has confirmed", async () => {
    const { sent, wrap } = recording();
    const storage = slowUpload();
    const s = await shell({ files: drawingFiles(), wrap, ...storage.files });
    await shown(s);
    await draw(s, storage);
    buttonNamed(s.ui, "End the test").click();
    await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
    buttonNamed(s.ui, "Yes, continue").click();
    await real(200);
    expect(types(sent)).not.toContain("end-test");
    storage.finish();
    await waitFor(() => expect(types(sent)).toContain("end-test"));
    expect(types(sent).filter((each) => each === "set-responses" || each === "end-test")).toEqual([
      "set-responses",
      "end-test",
    ]);
    await waitFor(() => expect(s.ui.querySelector(".ak-notice")?.textContent).toBe("The test has ended."));
  });

  it("keeps the stored drawing in the answer the engine submitted", async () => {
    const storage = slowUpload();
    const s = await shell({ files: drawingFiles(), ...storage.files });
    await shown(s);
    await draw(s, storage);
    buttonNamed(s.ui, "Submit answer").click();
    storage.finish();
    await waitFor(() => expect(s.client.view.current?.status).toBe("closed"));
    expect(s.client.view.current?.responses.get("RESPONSE")).toMatchObject({ value: { reference: "drawing-1" } });
  });

  it("lets a host that draws its own actions wait for the drawing, which has handed its response to the session by then", async () => {
    const { sent, wrap } = recording();
    const storage = slowUpload();
    const s = await shell({ files: drawingFiles(), ...storage.files, chrome: false, wrap });
    await shown(s);
    await draw(s, storage);
    const settling = s.mounted.settled().then(() => [...sent]);
    expect(await Promise.race([settling, real(200).then(() => "pending")])).toBe("pending");
    storage.finish();
    // The response is sent to the session before `settled()` resolves, so the host need not wait for the autosave to land.
    const handedOver = await settling;
    expect(types(handedOver).every((type) => type === "set-responses")).toBe(true);
    const response = handedOver.findLast((action) => action.type === "set-responses");
    expect(response?.type === "set-responses" && response.responses.get("RESPONSE")).toMatchObject({
      cardinality: "single",
      baseType: "file",
      value: { reference: `drawing-${storage.uploads()}` },
    });
  });

  it("draws on its own picture when the prompt has a picture too, which the stage of the content root must not take for its own", async () => {
    const prompt = `Draw on the second picture. <img src="${picture(20, 20, "#c62828")}" alt="A red square"/>`;
    const storage = slowUpload();
    const s = await shell({ files: drawingFiles(prompt), ...storage.files });
    await shown(s);
    await draw(s, storage);
    const canvas = contentOf(s.ui).querySelector("canvas.ak-canvas") as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    storage.finish();
    await s.mounted.settled();
  });

  it("sends a request at once when no interaction has work to finish", async () => {
    const { sent, wrap } = recording();
    const s = await shell({ wrap });
    await shown(s);
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(types(sent)).toEqual(["move"]));
  });
});

/** The files of the fixture with companion materials on the first item: a calculator, a ruler and a protractor. */
function toolFiles(): Readonly<Record<string, string | Uint8Array>> {
  const files = { ...examFiles() };
  const materials = [
    calculatorXml("basic", "A calculator for the sums."),
    ruleXml("A ruler for the lengths.", 10, ["1", "Centimeter"], ["1", "Millimeter"]),
    protractorXml("A protractor for the angles.", ["10", "Degree"], ["1", "Degree"]),
  ].join("");
  files["items/q1/item.xml"] = String(files["items/q1/item.xml"]).replace(
    "</qti-item-body>",
    `</qti-item-body><qti-companion-materials-info>${materials}</qti-companion-materials-info>`,
  );
  return files;
}

/** A profile with three tools that the candidate turns on and off. */
const TOOLS_PROFILE = `<access-for-all-pnp xmlns="${PNP_NAMESPACE}">
  <line-reader/><answer-masking/><dictionary-on-screen/><magnification><all-content zoom-amount="2"/></magnification>
  <activate-as-option-set><line-reader/><answer-masking/><dictionary-on-screen/><magnification/></activate-as-option-set>
</access-for-all-pnp>`;

const toolbar = (ui: ShadowRoot): HTMLButtonElement[] => [
  ...ui.querySelectorAll<HTMLButtonElement>(".ak-tools > .ak-row > button"),
];
const toolNames = (ui: ShadowRoot): (string | null)[] => toolbar(ui).map((button) => button.textContent);
const stageOf = (ui: ShadowRoot): HTMLElement => contentOf(ui).querySelector(".ak-root-stage") as HTMLElement;

describe("the tools in the player", () => {
  it("draws a button for each tool that the item asks for, and a tool opens over the item", async () => {
    const s = await shell({ files: toolFiles() });
    await waitFor(() => expect(toolNames(s.ui)).toEqual(["Ruler", "Protractor", "Basic calculator"]));
    expect(s.ui.querySelector(".ak-tools")?.getAttribute("aria-label")).toBe("Tools");
    buttonNamed(s.ui, "Ruler").click();
    const layer = stageOf(s.ui).querySelector(".ak-tool-layer");
    await waitFor(() => expect(layer?.querySelector(".ak-placed")).not.toBeNull());
    expect(buttonNamed(s.ui, "Ruler").getAttribute("aria-pressed")).toBe("true");
    // The panel is in the chrome, and the ruler lies over the item in the stage of the content root.
    expect(s.ui.querySelector(".ak-tray .ak-panel")?.textContent).toContain("A ruler for the lengths.");
    expect(layer?.parentElement).toBe(stageOf(s.ui));
    expect(stageOf(s.ui).querySelector(".ak-content")).not.toBeNull();
    buttonNamed(s.ui, "Ruler").click();
    await waitFor(() => expect(layer?.querySelector(".ak-placed")).toBeNull());
  });

  it("works a calculator from the panel in the chrome", async () => {
    const s = await shell({ files: toolFiles() });
    await waitFor(() => expect(toolNames(s.ui)).toContain("Basic calculator"));
    buttonNamed(s.ui, "Basic calculator").click();
    const key = (name: string): HTMLButtonElement =>
      [...s.ui.querySelectorAll<HTMLButtonElement>(".ak-calculator button")].find(
        (button) => button.textContent === name,
      ) as HTMLButtonElement;
    await waitFor(() => expect(key("2")).toBeDefined());
    for (const name of ["2", "+", "3", "="]) key(name).click();
    expect(s.ui.querySelector(".ak-display")?.textContent).toBe("5");
  });

  it("keeps a tool that the next item shares, and takes the others away with an item that asks for none", async () => {
    const s = await shell({ files: toolFiles() });
    await waitFor(() => expect(toolNames(s.ui)).toHaveLength(3));
    buttonNamed(s.ui, "Ruler").click();
    await waitFor(() => expect(stageOf(s.ui).querySelector(".ak-placed")).not.toBeNull());
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    await waitFor(() => expect(toolNames(s.ui)).toEqual([]));
    expect(s.ui.querySelector(".ak-tools")?.hasAttribute("hidden")).toBe(true);
    expect(stageOf(s.ui).querySelector(".ak-placed")).toBeNull();
    buttonNamed(s.ui, "Previous").click();
    await waitFor(() => expect(toolNames(s.ui)).toHaveLength(3));
    expect(buttonNamed(s.ui, "Ruler").getAttribute("aria-pressed")).toBe("false");
  });

  it("turns the line reader on from its button through the session, and the band lies over the text of the item", async () => {
    const { sent, wrap } = recording();
    const s = await shell({ profile: TOOLS_PROFILE, wrap });
    await waitFor(() => expect(toolNames(s.ui)).toContain("Line reader"));
    buttonNamed(s.ui, "Line reader").click();
    await waitFor(() => expect(stageOf(s.ui).querySelector(".ak-line-reader")).not.toBeNull());
    expect(sent).toContainEqual({ type: "support", name: "line-reader", active: true });
    expect(buttonNamed(s.ui, "Line reader").getAttribute("aria-pressed")).toBe("true");
    buttonNamed(s.ui, "Line reader").click();
    await waitFor(() => expect(stageOf(s.ui).querySelector(".ak-line-reader")).toBeNull());
    expect(sent).toContainEqual({ type: "support", name: "line-reader", active: false });
  });

  it("masks the choices of the item shown and of the next item while masking is on", async () => {
    const s = await shell({ profile: TOOLS_PROFILE });
    await waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    buttonNamed(s.ui, "Answer masking").click();
    await waitFor(() =>
      expect(contentOf(s.ui).querySelector("qti-choice-interaction")?.hasAttribute("data-ak-masked")).toBe(true),
    );
    expect(contentOf(s.ui).querySelector(".ak-mask")).not.toBeNull();
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    await waitFor(() =>
      expect(contentOf(s.ui).querySelector("qti-choice-interaction")?.hasAttribute("data-ak-masked")).toBe(true),
    );
    expect(contentOf(s.ui).querySelectorAll(".ak-mask")).toHaveLength(1);
  });

  it("keeps the marks of the highlighter with the item through the shell: they come back when the item does", async () => {
    const profile = `<access-for-all-pnp xmlns="${PNP_NAMESPACE}"><x:highlighter xmlns:x="urn:example:pnp"/></access-for-all-pnp>`;
    const s = await shell({ profile });
    await waitFor(() => expect(toolNames(s.ui)).toContain("Highlighter"));
    await waitFor(() => expect(stageOf(s.ui).querySelector(".ak-caret")).not.toBeNull());
    const wordAt = (text: string): { x: number; y: number } => {
      const stage = stageOf(s.ui);
      const walker = document.createTreeWalker(stage.querySelector(".ak-body") as Element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node instanceof Text; node = walker.nextNode()) {
        const at = node.data.indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const box = range.getBoundingClientRect();
        const around = stage.getBoundingClientRect();
        return { x: box.left + box.width / 2 - around.left, y: box.top + box.height / 2 - around.top };
      }
      throw new Error(`The item has no word ${text}.`);
    };
    const marks = (): string[] =>
      [...s.ui.querySelectorAll(".ak-mark-item span")].map((each) => each.textContent ?? "");
    await userEvent.click(stageOf(s.ui), { position: wordAt("Look") });
    expect(marks()).toEqual(["Look"]);
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    await waitFor(() => expect(marks()).toEqual([]));
    buttonNamed(s.ui, "Previous").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q1"));
    await waitFor(() => expect(marks()).toEqual(["Look"]));
    expect(stageOf(s.ui).querySelectorAll(".ak-mark")).toHaveLength(1);
  });

  it("builds a tool that the host provides in its panel, and takes it down when it closes", async () => {
    const built: string[] = [];
    const tools: ToolSlots = {
      dictionary: (host, { language }) => {
        host.textContent = `A dictionary for ${language}`;
        built.push("built");
        return () => void built.push("down");
      },
    };
    const s = await shell({ profile: TOOLS_PROFILE, tools });
    await waitFor(() => expect(toolNames(s.ui)).toContain("Dictionary"));
    buttonNamed(s.ui, "Dictionary").click();
    await waitFor(() => expect(s.ui.querySelector(".ak-tray")?.textContent).toContain("A dictionary for en"));
    buttonNamed(s.ui, "Dictionary").click();
    await waitFor(() => expect(built).toEqual(["built", "down"]));
  });

  it("says that a tool of the host is not available when the host gives no function for it", async () => {
    const s = await shell({ profile: TOOLS_PROFILE });
    await waitFor(() => expect(toolNames(s.ui)).toContain("Dictionary"));
    buttonNamed(s.ui, "Dictionary").click();
    await waitFor(() => expect(s.ui.querySelector(".ak-tray")?.textContent).toContain("This tool is not available."));
  });

  it("draws no tools when the host draws the chrome", async () => {
    const s = await shell({ files: toolFiles(), chrome: false });
    await shown(s);
    expect(s.ui.querySelector(".ak-tools")).toBeNull();
    expect(stageOf(s.ui).querySelector(".ak-tool-layer")).toBeNull();
  });

  it("has no violation of WCAG 2.2 A and AA with the toolbar, a panel and a ruler open", async () => {
    const s = await shell({ files: toolFiles() });
    await waitFor(() => expect(toolNames(s.ui)).toHaveLength(3));
    buttonNamed(s.ui, "Ruler").click();
    buttonNamed(s.ui, "Basic calculator").click();
    await waitFor(() => expect(s.ui.querySelectorAll(".ak-panel")).toHaveLength(2));
    expect(await axeViolations(s.page)).toEqual([]);
  });

  it("gives the content root only the styles of what lies over the item, so that the toolbar styles do not restyle the interactions", async () => {
    const s = await shell({ files: toolFiles() });
    await waitFor(() => expect(toolNames(s.ui)).toHaveLength(3));
    // The shell mounts the tools before the first item is drawn, and drawing it keeps the sheet.
    const sheets = [...(contentHostOf(s.ui).shadowRoot?.adoptedStyleSheets ?? [])];
    const stage = sheets.find((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.startsWith(".ak-tool-layer")));
    expect(stage).toBeDefined();
    const selectors = [...(stage?.cssRules ?? [])].map((rule) =>
      rule instanceof CSSStyleRule ? rule.selectorText : "",
    );
    expect(
      selectors.filter((selector) => /^\.ak-(tools|row|tray|field)\b/u.test(selector) || selector === ".ak-button"),
    ).toEqual([]);
    expect(computed(stageOf(s.ui).querySelector(".ak-tool-layer") as Element, "position")).toBe("absolute");
  });
});

describe("magnification in the player", () => {
  it("enlarges media sized in pixels when magnification is turned on, without drawing the item again or losing the answer", async () => {
    const s = await shell({ profile: TOOLS_PROFILE });
    await waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    choices(s.ui)[1]?.click();
    await waitFor(() => expect(statusOf(s.ui)).toBe("Answers saved."));
    const body = contentOf(s.ui).querySelector(".ak-body");
    const image = (): HTMLImageElement => contentOf(s.ui).querySelector("img") as HTMLImageElement;
    expect([image().getAttribute("width"), image().getAttribute("height")]).toEqual(["10", "10"]);
    buttonNamed(s.ui, "Magnification").click();
    await waitFor(() => expect(image().getAttribute("width")).toBe("20"));
    expect(image().getAttribute("height")).toBe("20");
    expect(contentHostOf(s.ui).style.getPropertyValue("--ak-text-zoom")).toBe("2");
    expect(contentOf(s.ui).querySelector(".ak-body")).toBe(body);
    expect(choices(s.ui).map((input) => input.checked)).toEqual([false, true]);
    buttonNamed(s.ui, "Magnification").click();
    await waitFor(() => expect(image().getAttribute("width")).toBe("10"));
    expect(contentOf(s.ui).querySelector(".ak-body")).toBe(body);
  });

  it("draws the next item at the magnification of the moment", async () => {
    const files = { ...examFiles() };
    files["items/q2/item.xml"] = String(files["items/q2/item.xml"]).replace(
      "<p>Question</p>",
      '<p>Question <img src="images/map.png" alt="Map" width="30" height="30"/></p>',
    );
    const s = await shell({ profile: TOOLS_PROFILE, files });
    await waitFor(() => expect(choices(s.ui)).toHaveLength(2));
    buttonNamed(s.ui, "Magnification").click();
    await waitFor(() => expect(contentOf(s.ui).querySelector("img")?.getAttribute("width")).toBe("20"));
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    await waitFor(() => expect(contentOf(s.ui).querySelector("img")?.getAttribute("width")).toBe("60"));
  });
});

describe("pronunciation lexicons in the player", () => {
  const voiceOf = (requests: SpeechRequest[]) => ({
    speak: async (request: SpeechRequest): Promise<void> => void requests.push(request),
    stop: () => undefined,
  });
  /** Presses Read aloud until the voice has been given a request that holds the text. */
  const reads = async (s: Shell, requests: SpeechRequest[], text: string): Promise<void> => {
    await waitFor(() => {
      buttonNamed(s.ui, "Read aloud").click();
      expect(requests.at(-1)?.text).toContain(text);
    });
  };

  it("reads with the lexicons that the item depends on, and with none for an item that depends on none", async () => {
    const requests: SpeechRequest[] = [];
    const s = await shell({ profile: PROFILE, files: lexiconFiles(), voice: voiceOf(requests) });
    await shown(s);
    expect(s.client.documents.lexicons).toEqual(["items/q1/words.pls"]);
    await reads(s, requests, "the World Wide Web Consortium and");
    buttonNamed(s.ui, "Next").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
    expect(s.client.documents.lexicons).toEqual([]);
    await reads(s, requests, "The W3C again");
    expect(requests.at(-1)?.text).not.toContain("World Wide Web Consortium");
    buttonNamed(s.ui, "Previous").click();
    await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q1"));
    await reads(s, requests, "World Wide Web Consortium");
  });

  it("puts the alias of the lexicon in the SSML for a voice that takes it", async () => {
    const requests: SpeechRequest[] = [];
    const s = await shell({ profile: PROFILE, files: lexiconFiles(), voice: voiceOf(requests) });
    await shown(s);
    await reads(s, requests, "World Wide Web Consortium");
    expect(requests.at(-1)?.ssml).toContain('<sub alias="World Wide Web Consortium">W3C</sub>');
  });

  it("reads on without a lexicon that is not a PLS document", async () => {
    const requests: SpeechRequest[] = [];
    const s = await shell({ profile: PROFILE, files: lexiconFiles("<p>Not a lexicon.</p>"), voice: voiceOf(requests) });
    await shown(s);
    await waitFor(() => {
      buttonNamed(s.ui, "Read aloud").click();
      expect(requests.at(-1)?.text).toContain("Look at the W3C and");
    });
    expect(requests.at(-1)?.text).not.toContain("World Wide Web Consortium");
  });

  it("reads on without a lexicon that the package does not have", async () => {
    const requests: SpeechRequest[] = [];
    const files = { ...lexiconFiles() };
    delete files["items/q1/words.pls"];
    const s = await shell({ profile: PROFILE, files, voice: voiceOf(requests) });
    await shown(s);
    await waitFor(() => {
      buttonNamed(s.ui, "Read aloud").click();
      expect(requests.at(-1)?.text).toContain("Look at the W3C and");
    });
  });
});

describe("the spell check of the browser", () => {
  /** An item whose one task is a text to write. */
  const WritingItem = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="q1" title="Item q1" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body><qti-extended-text-interaction response-identifier="RESPONSE"/></qti-item-body>
</qti-assessment-item>`;
  const files = { ...examFiles(), "items/q1/item.xml": WritingItem };
  const profile = (sets: string): string =>
    `<access-for-all-pnp xmlns="${PNP_NAMESPACE}"><spell-checker-on-screen/>${sets}</access-for-all-pnp>`;
  const spellcheck = (s: Shell): Promise<string | null | undefined> =>
    waitFor(() => {
      const area = contentOf(s.ui).querySelector("textarea");
      expect(area).not.toBeNull();
      return area?.getAttribute("spellcheck");
    });

  it("is off while the candidate writes, and when the support of the spell checker is not on", async () => {
    const plain = await shell({ files });
    expect(await spellcheck(plain)).toBe("false");
    const off = await shell({
      files,
      profile: profile("<activate-as-option-set><spell-checker-on-screen/></activate-as-option-set>"),
    });
    expect(await spellcheck(off)).toBe("false");
  });

  it("is on while the support is on, from the start or after the candidate turns it on, and off again when it is turned off", async () => {
    const started = await shell({
      files,
      profile: profile("<activate-at-initialization-set><spell-checker-on-screen/></activate-at-initialization-set>"),
    });
    expect(await spellcheck(started)).toBe("true");
    const option = await shell({
      files,
      profile: profile("<activate-as-option-set><spell-checker-on-screen/></activate-as-option-set>"),
    });
    expect(await spellcheck(option)).toBe("false");
    const turn = (active: boolean) =>
      option.client.dispatch({ type: "support", name: "spell-checker-on-screen", active });
    expect((await turn(true)).refusal).toBeUndefined();
    await waitFor(() =>
      expect(contentOf(option.ui).querySelector("textarea")?.getAttribute("spellcheck")).toBe("true"),
    );
    expect((await turn(false)).refusal).toBeUndefined();
    await waitFor(() =>
      expect(contentOf(option.ui).querySelector("textarea")?.getAttribute("spellcheck")).toBe("false"),
    );
  });
});

describe("a recording kept at the clock", () => {
  /** An item whose one task is a recording that starts at once, in the types that every engine records in. */
  const RecordingItem = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="q1" title="Item q1" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="file"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body>
    <qti-upload-interaction response-identifier="RESPONSE" type="audio/webm audio/ogg audio/mp4 audio/wav" data-ak-record-start="0"/>
  </qti-item-body>
</qti-assessment-item>`;
  const recordingFiles = () => ({
    ...examFiles({ limits: '<qti-time-limits max-time="30"/>' }),
    "items/q1/item.xml": RecordingItem,
  });

  /** The host's storage of recordings: it names a file, and keeps the bytes when the test lets them arrive. */
  function recordingStore() {
    const reserved: FileValue[] = [];
    const reserveSignals: (AbortSignal | undefined)[] = [];
    const filled = new Map<string, Blob>();
    const fillSignals: (AbortSignal | undefined)[] = [];
    const held: (() => void)[] = [];
    const store = {
      holding: false,
      reserved,
      reserveSignals,
      filled,
      fillSignals,
      waiting: () => held.length,
      release: () => {
        for (const go of held.splice(0)) go();
      },
      reserve: async (mimeType: string, fileName?: string, options?: { readonly signal?: AbortSignal }) => {
        reserveSignals.push(options?.signal);
        const file = {
          reference: `recording-${reserved.length + 1}`,
          mimeType,
          ...(fileName === undefined ? {} : { fileName }),
        };
        reserved.push(file);
        return file;
      },
      fill: async (file: FileValue, bytes: Blob, options?: { readonly signal?: AbortSignal }) => {
        fillSignals.push(options?.signal);
        if (store.holding) await new Promise<void>((go) => held.push(go));
        filled.set(file.reference, bytes);
      },
    };
    return store;
  }

  /** The file that the store named for the recording. */
  const named = (store: { readonly reserved: readonly FileValue[] }): FileValue => {
    const [file] = store.reserved;
    if (file === undefined) throw new Error("The store named no file.");
    return file;
  };

  /** The largest sample of a recording, which is above 0 for a recording of the oscillator and 0 for silence. */
  async function loudest(bytes: Blob): Promise<number> {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await bytes.arrayBuffer());
      let peak = 0;
      for (const sample of decoded.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
      return peak;
    } finally {
      await context.close();
    }
  }

  /**
   * A shell whose first item records at once, with the oscillator for a microphone, once half a second of sound has played
   * and the response of the recording has reached the host: the client holds the responses of an exam for a second before it
   * sends them.
   */
  async function recording(practice: boolean, context: Parameters<typeof needsAudio>[0]) {
    await needsAudio(context, audioContextRuns());
    const streams: MediaStream[] = [];
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockImplementation(async () => {
      const stream = await fakeMicrophone();
      streams.push(stream);
      return stream;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const store = recordingStore();
    const dispatched: Promise<unknown>[] = [];
    const wrap = (client: SessionClient): SessionClient =>
      withDispatch(client, (action) => {
        const sent = client.dispatch(action);
        dispatched.push(sent);
        return sent;
      });
    const s = await shell({ files: recordingFiles(), practice, reserve: store.reserve, fill: store.fill, wrap });
    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => expect(contentOf(s.ui).querySelector(".ak-recording")).not.toBeNull());
    const [stream] = streams;
    if (stream === undefined) throw new Error("The recording asked for no microphone.");
    await heard(stream, 0.5);
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.all(dispatched);
    return { s, store };
  }

  /** The file that the first item names as its response in the results of the session. */
  async function answerOf(s: Shell): Promise<unknown> {
    const report = await s.hostSession.results();
    const q1 = report.itemResults.find(({ identifier }) => identifier === "q1");
    const response = q1?.variables.find(({ kind, identifier }) => kind === "response" && identifier === "RESPONSE");
    return response?.kind === "response" ? response.candidateResponse : undefined;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe.each([
    ["an exam", false],
    ["practice", true],
  ])("in %s", (_name, practice) => {
    it("keeps the answer of a candidate who is speaking when the time for the question is over, and the sound follows", async (context) => {
      const { s, store } = await recording(practice, context);
      const reserved = named(store);
      s.clock.advance(31 * SECOND);
      await s.hostSession.apply({ type: "time" });
      await s.client.refresh();
      await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
      expect(await answerOf(s)).toEqual(single("file", reserved));
      await waitFor(() => expect(store.filled.size).toBe(1));
      expect(await loudest(store.filled.get(reserved.reference) ?? new Blob())).toBeGreaterThan(0);
    });

    it("keeps the answer when the candidate goes on, which does not wait for the upload", async (context) => {
      const { s, store } = await recording(practice, context);
      const reserved = named(store);
      store.holding = true;
      buttonNamed(s.ui, "Next").click();
      await waitFor(() => expect(heading(s.ui).textContent).toBe("Item q2"));
      expect(store.filled.size).toBe(0);
      buttonNamed(s.ui, "End the test").click();
      await waitFor(() => expect(dialogOf(s.ui)?.open).toBe(true));
      buttonNamed(s.ui, "Yes, continue").click();
      await waitFor(() => expect(s.ui.querySelector(".ak-notice")?.textContent).toBe("The test has ended."));
      expect(await answerOf(s)).toEqual(single("file", reserved));
      expect(store.filled.size).toBe(0);
      await waitFor(() => expect(store.waiting()).toBe(1));
      store.release();
      await waitFor(() => expect(store.filled.size).toBe(1));
      expect(await loudest(store.filled.get(reserved.reference) ?? new Blob())).toBeGreaterThan(0);
    });

    it("stores the sound of a recording when the player is destroyed, which does not abort the store", async (context) => {
      const { s, store } = await recording(practice, context);
      const reserved = named(store);
      s.mounted.destroy();
      await waitFor(() => expect(store.filled.size).toBe(1));
      expect(store.fillSignals).toEqual([undefined]);
      expect(store.reserveSignals.map((signal) => signal instanceof AbortSignal)).toEqual([true]);
      expect(await loudest(store.filled.get(reserved.reference) ?? new Blob())).toBeGreaterThan(0);
    });
  });

  it("keeps the answer when a proctor ends the test", async (context) => {
    const { s, store } = await recording(false, context);
    const reserved = named(store);
    expect((await s.host.proctor(ALICE.session, { type: "end-test" })).refusal).toBeUndefined();
    await s.client.refresh();
    await waitFor(() => expect(store.filled.size).toBe(1));
    expect(await answerOf(s)).toEqual(single("file", reserved));
    expect(await loudest(store.filled.get(reserved.reference) ?? new Blob())).toBeGreaterThan(0);
  });
});
