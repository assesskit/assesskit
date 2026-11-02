import { type CandidateView, createEngine } from "@assesskit/runtime/delivery";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EN_MESSAGES } from "../src/index.js";
import { ID_MESSAGES } from "../src/messages/id/index.js";
import {
  bindToLifetime,
  clockText,
  confirmationText,
  planActions,
  REFUSAL_MESSAGES,
  spokenText,
} from "../src/player/delivery/internal.js";
import { REFUSAL_CODES } from "../src/protocol/index.js";
import { examDefinition, examFiles, packageOf } from "./exam-fixture.js";

const START = 1_700_000_000_000;

/** The view of a new session of the fixture test, as the engine gives it. */
function firstView(part?: string): CandidateView {
  const engine = createEngine(examDefinition(packageOf(examFiles(part === undefined ? {} : { part }))));
  const step = engine.start({ seed: 1, at: START });
  if (!step.ok) throw new Error("The fixture test starts.");
  return engine.view(step.state, START);
}

const ids = (view: CandidateView): string[] => planActions(view).map(({ id }) => id);

describe("planActions", () => {
  it("plans a button for each action that the view lists and that a button can send", () => {
    const view = firstView();
    expect(view.actions).toEqual([
      "set-responses",
      "submit",
      "skip",
      "mark",
      "move",
      "end-part",
      "end-test",
      "suspend",
    ]);
    expect(ids(view)).toEqual(["previous", "next", "submit", "skip", "end-part", "end-test", "suspend"]);
  });

  it("plans no button for suspend or resume when the view does not list them, as a view for an exam does not", () => {
    const view = firstView();
    const exam: CandidateView = {
      ...view,
      actions: view.actions.filter((type) => type !== "suspend" && type !== "resume"),
    };
    expect(ids(exam)).not.toContain("suspend");
    expect(ids({ ...view, actions: ["resume"] })).toEqual(["resume"]);
  });

  it("offers moving back only in a nonlinear part, and not before the first item or after the last", () => {
    const view = firstView();
    const [first, second, third] = view.navigation.filter((entry) => entry.kind === "item");
    expect(planActions(view).find(({ id }) => id === "previous")?.disabled).toBe(true);
    expect(planActions(view).find(({ id }) => id === "next")?.disabled).toBe(false);
    const at = (entry: typeof second): CandidateView => ({
      ...view,
      navigation: view.navigation.map((each) => (each.kind === "item" ? { ...each, current: each === entry } : each)),
    });
    expect(planActions(at(third)).find(({ id }) => id === "next")?.disabled).toBe(true);
    expect(planActions(at(second)).find(({ id }) => id === "previous")?.disabled).toBe(false);
    expect(first?.kind).toBe("item");
    const linear = firstView('navigation-mode="linear" submission-mode="individual"');
    expect(ids(linear)).not.toContain("previous");
    expect(planActions(linear).find(({ id }) => id === "next")?.disabled).toBe(false);
  });

  it("asks to confirm the end of a part and of the test, and a submit in a linear part only", () => {
    const nonlinear = planActions(firstView());
    const confirms = (planned: ReturnType<typeof planActions>) =>
      planned.flatMap(({ id, confirm }) => (confirm === undefined ? [] : [[id, confirm]]));
    expect(confirms(nonlinear)).toEqual([
      ["end-part", "end-part"],
      ["end-test", "end-test"],
    ]);
    expect(confirms(planActions(firstView('navigation-mode="linear" submission-mode="individual"')))).toEqual([
      ["submit", "submit"],
      ["end-part", "end-part"],
      ["end-test", "end-test"],
    ]);
  });

  it("sends the actions of the item presented with its key", () => {
    const view = firstView();
    const submit = planActions(view).find(({ id }) => id === "submit");
    expect(submit?.action).toEqual({ type: "submit", item: { ref: "q1", instance: 1 } });
  });

  describe("Mark for review", () => {
    const markedAt = (view: CandidateView, marked: boolean): CandidateView => ({
      ...view,
      navigation: view.navigation.map((entry) =>
        entry.kind === "item" ? { ...entry, marked: entry.current && marked } : entry,
      ),
    });

    it("is a toggle in a nonlinear part when the host asks for it, and not otherwise", () => {
      const view = firstView();
      expect(ids(view)).not.toContain("mark");
      expect(planActions(view, false).map(({ id }) => id)).not.toContain("mark");
      const planned = planActions(view, true).find(({ id }) => id === "mark");
      expect(planned).toEqual({
        id: "mark",
        label: "actionMark",
        action: { type: "mark", item: { ref: "q1", instance: 1 }, marked: true },
        group: "answer",
        pressed: false,
      });
      expect(planActions(markedAt(view, true), true).find(({ id }) => id === "mark")).toMatchObject({
        action: { type: "mark", item: { ref: "q1", instance: 1 }, marked: false },
        pressed: true,
      });
    });

    it("is offered in no linear part, and not when the view does not list the action", () => {
      const linear = firstView('navigation-mode="linear" submission-mode="individual"');
      expect(linear.actions).toContain("mark");
      expect(planActions(linear, true).map(({ id }) => id)).not.toContain("mark");
      const view = firstView();
      const without: CandidateView = { ...view, actions: view.actions.filter((type) => type !== "mark") };
      expect(planActions(without, true).map(({ id }) => id)).not.toContain("mark");
    });

    it("stands among the buttons that act on the item, after submit and skip", () => {
      expect(planActions(firstView(), true).map(({ id }) => id)).toEqual([
        "previous",
        "next",
        "submit",
        "skip",
        "mark",
        "end-part",
        "end-test",
        "suspend",
      ]);
    });
  });

  it("plans nothing for an ended test", () => {
    expect(planActions({ ...firstView(), actions: [], current: undefined, navigation: [] })).toEqual([]);
  });
});

describe("confirmationText", () => {
  it("asks the question of the action", () => {
    const view = firstView();
    expect(confirmationText("submit", view, EN_MESSAGES)).toEqual([EN_MESSAGES.confirmSubmit]);
    expect(confirmationText("end-part", view, EN_MESSAGES)[0]).toBe(EN_MESSAGES.confirmEndPart);
    expect(confirmationText("end-test", view, ID_MESSAGES)[0]).toBe(ID_MESSAGES.confirmEndTest);
  });

  it("says how many questions have an attempt open and so are not submitted", () => {
    const view = firstView();
    const open = view.navigation.filter((entry) => entry.kind === "item" && entry.status === "interacting").length;
    expect(open).toBe(1);
    expect(confirmationText("end-test", view, EN_MESSAGES)).toEqual([
      EN_MESSAGES.confirmEndTest,
      `${EN_MESSAGES.confirmUnsubmitted}: 1`,
    ]);
    const closed: CandidateView = {
      ...view,
      navigation: view.navigation.map((entry) => (entry.kind === "item" ? { ...entry, status: "closed" } : entry)),
    };
    expect(confirmationText("end-test", closed, EN_MESSAGES)).toEqual([EN_MESSAGES.confirmEndTest]);
  });

  it("says that a simultaneous part submits all its answers when it ends", () => {
    const view = firstView('navigation-mode="nonlinear" submission-mode="simultaneous"');
    expect(view.part?.submissionMode).toBe("simultaneous");
    expect(confirmationText("end-part", view, EN_MESSAGES)).toContain(EN_MESSAGES.confirmSimultaneous);
    expect(confirmationText("end-part", firstView(), EN_MESSAGES)).not.toContain(EN_MESSAGES.confirmSimultaneous);
  });
});

describe("duration", () => {
  it("writes the time left as a clock, counting a part of a second as a whole one", () => {
    expect(clockText(0)).toBe("0:00");
    expect(clockText(1)).toBe("0:01");
    expect(clockText(65_000)).toBe("1:05");
    expect(clockText(59_001)).toBe("1:00");
    expect(clockText(600_000)).toBe("10:00");
    expect(clockText(3_661_000)).toBe("1:01:01");
  });

  it("writes the time left in words of the language of the interface", () => {
    expect(spokenText(200_000, "en")).toBe("3 minutes 20 seconds");
    expect(spokenText(60_000, "en")).toBe("1 minute");
    expect(spokenText(3_600_000, "en")).toBe("1 hour");
    expect(spokenText(200_000, "id")).toBe("3 menit 20 detik");
  });

  it("falls back to English for a language tag that is not one", () => {
    expect(spokenText(90_000, "not a tag!")).toBe("1 minute 30 seconds");
  });
});

describe("REFUSAL_MESSAGES", () => {
  it("has a message for every refusal code, in every catalog, and none is the message of another", () => {
    expect(Object.keys(REFUSAL_MESSAGES).sort()).toEqual([...REFUSAL_CODES].sort());
    for (const catalog of [EN_MESSAGES, ID_MESSAGES]) {
      const texts = REFUSAL_CODES.map((code) => catalog[REFUSAL_MESSAGES[code]]);
      for (const text of texts) expect(text.trim()).not.toBe("");
      expect(new Set(texts).size).toBe(texts.length);
    }
  });
});

describe("properties", () => {
  it("plans only actions that the view lists", () => {
    const view = firstView();
    const types = fc.subarray([...view.actions]);
    fc.assert(
      fc.property(types, (actions) => {
        for (const planned of planActions({ ...view, actions })) {
          expect(actions).toContain(planned.action.type);
        }
      }),
    );
  });

  it("writes the clock of any time left with the seconds of the ceiling", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400_000_000 }), (milliseconds) => {
        const total = Math.ceil(milliseconds / 1000);
        const [seconds, minutes, hours = "0"] = clockText(milliseconds).split(":").reverse();
        expect(Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)).toBe(total);
      }),
    );
  });
});

describe("bindToLifetime", () => {
  /** The settings of a mount that record what the host's functions receive. */
  function settings() {
    const received: { readonly what: string; readonly signal: AbortSignal | undefined }[] = [];
    const reports: unknown[] = [];
    const bytes = new Blob(["x"]);
    const file = { reference: "f", mimeType: "x/y" };
    const base = {
      fetch: async (_url: string, request: { readonly signal?: AbortSignal }) => {
        received.push({ what: "fetch", signal: request.signal });
        return { ok: true, status: 200, text: async () => "" };
      },
      files: {
        upload: async (_bytes: Blob, _type: string, _name?: string, options?: { readonly signal?: AbortSignal }) => {
          received.push({ what: "upload", signal: options?.signal });
          return file;
        },
        read: async (_file: unknown, options?: { readonly signal?: AbortSignal }) => {
          received.push({ what: "read", signal: options?.signal });
          return new Uint8Array();
        },
        url: (_file: unknown) => "https://assets.example/f",
        reserve: async (_type: string, _name?: string, options?: { readonly signal?: AbortSignal }) => {
          received.push({ what: "reserve", signal: options?.signal });
          return file;
        },
        fill: async (_file: unknown, _bytes: Blob, options?: { readonly signal?: AbortSignal }) => {
          received.push({ what: "fill", signal: options?.signal });
        },
      },
      report: (error: unknown) => void reports.push(error),
    };
    const state = { destroyed: false, stop: new AbortController() };
    // The binding reads only the three functions of the settings and the two fields of the state.
    const bound = bindToLifetime(base as never, state as never) as typeof base;
    return { bound, received, reports, state, bytes, file };
  }

  it("gives the signal of the mount to every fetch and to every call of the host's files", async () => {
    const { bound, received, state, bytes, file } = settings();
    await bound.fetch("https://assets.example/a.css", { credentials: "omit", referrerPolicy: "no-referrer" } as never);
    await bound.files.upload(bytes, "x/y", "a.txt");
    await bound.files.read(file);
    expect(received.map(({ what }) => what)).toEqual(["fetch", "upload", "read"]);
    expect(received.every(({ signal }) => signal === state.stop.signal)).toBe(true);
    expect(bound.files.url(file)).toBe("https://assets.example/f");
  });

  it("ends the reservation of a file with the mount and leaves the store of its bytes to the caller's signal", async () => {
    const { bound, received, state, bytes, file } = settings();
    await bound.files.reserve("audio/webm", "recording.webm");
    await bound.files.fill(file, bytes);
    const own = new AbortController();
    await bound.files.fill(file, bytes, { signal: own.signal });
    expect(received.map(({ what, signal }) => [what, signal])).toEqual([
      ["reserve", state.stop.signal],
      ["fill", undefined],
      ["fill", own.signal],
    ]);
  });

  it("leaves out reserve and fill when the host's files have none", () => {
    const bound = bindToLifetime(
      {
        fetch: () => undefined,
        files: { upload: () => undefined, read: () => undefined, url: () => "" },
        report: () => undefined,
      } as never,
      { destroyed: false, stop: new AbortController() } as never,
    ) as { readonly files: Record<string, unknown> };
    expect(Object.keys(bound.files)).toEqual(["upload", "read", "url"]);
  });

  it("keeps the signal that a call brings, and reports until the mount is destroyed", async () => {
    const { bound, received, reports, state, file } = settings();
    const own = new AbortController();
    await bound.files.read(file, { signal: own.signal });
    expect(received[0]?.signal).toBe(own.signal);
    bound.report("first");
    state.destroyed = true;
    bound.report("second");
    expect(reports).toEqual(["first"]);
  });
});
