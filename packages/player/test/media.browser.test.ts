import { buildSingle } from "@assesskit/runtime/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { followPlayback, Playback, type PlaybackNotice } from "../src/player/media/index.js";
import { audioPlaysToEnd, needsAudio } from "./audio.js";
import { ASSETS, mountScene, type Scene } from "./interactions-fixture.js";
import { axeViolations } from "./renderer-fixture.js";
import { waitFor } from "./wait.js";

const DECLARATION = `<qti-response-declaration identifier="R" cardinality="single" base-type="integer"/>`;

/**
 * A media interaction with captions over a recording of the fixtures: by default twenty seconds of silence, which
 * outlast the 15 seconds that a test has, or the blip of a quarter of a second, which a test plays to its end.
 */
const BODY = (
  attributes: string,
  source = "long",
): string => `<qti-media-interaction response-identifier="R" autostart="false" ${attributes}>
  <qti-prompt>Listen to the tone.</qti-prompt>
  <audio><source src="media/${source}.wav" type="audio/wav"/><track kind="captions" src="media/captions.vtt" srclang="en" label="English"/></audio>
</qti-media-interaction>`;

/** Skips a test that plays a recording to its end where the host has no sound device. */
const needsPlaybackToEnd = (context: { skip(): never }): Promise<void> =>
  needsAudio(context, audioPlaysToEnd(`${ASSETS}items/q1/media/blip.wav`));

const audioOf = (scene: Scene): HTMLAudioElement => scene.find<HTMLAudioElement>("audio");
const button = (scene: Scene, name: string): HTMLButtonElement =>
  scene.findAll<HTMLButtonElement>(".ak-media-bar button").find(({ textContent }) => textContent === name) ??
  scene.find("none");
const plays = (scene: Scene): unknown => scene.responses.at(-1)?.value;
/** Whether a recording is not playing: it is paused, or, in browsers that do not pause it, it has ended. */
const idle = (audio: HTMLAudioElement): boolean => audio.paused || audio.ended;
const playing = (audio: HTMLAudioElement): boolean => !idle(audio);
/** Resolves with the next event of a type that the recording sends. */
const next = (audio: HTMLAudioElement, type: string): Promise<void> =>
  new Promise((done) => audio.addEventListener(type, () => done(), { once: true }));
/**
 * Presses play and resolves once the browser has sent `playing`, which it sends when the data has come and which counts
 * a play, or, with `play`, once it has sent the event of the request. A recording that resumes after a pause sends `play`
 * in every engine, and `playing` not in a sandbox without a sound device.
 */
async function playFrom(scene: Scene, event: "play" | "playing" = "playing"): Promise<void> {
  const started = next(audioOf(scene), event);
  await userEvent.click(button(scene, "Play"));
  await started;
}
/** Makes the timers of the page wait for the test, which moves them with `vi.advanceTimersByTime`. */
const holdTimers = (): void => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
};

describe("media", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("draws the controls of the player in place of the controls of the browser, named by the prompt", async () => {
    const scene = mountScene(DECLARATION, BODY(""));
    expect(audioOf(scene).hasAttribute("controls")).toBe(false);
    expect(scene.findAll(".ak-media-bar button").map((control) => control.textContent)).toEqual([
      "Play",
      "Back to start",
      "Captions",
    ]);
    expect(scene.find(".ak-media-bar").getAttribute("aria-label")).toBe("Media player");
    expect(scene.interaction().getAttribute("aria-labelledby")).toBe(scene.find("qti-prompt").id);
    expect(scene.find(".ak-media-status").textContent).toBe("Plays 0.");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("gives the number of plays as the response, one for each time playback starts from the start", async (context) => {
    await needsPlaybackToEnd(context);
    const scene = mountScene(DECLARATION, BODY("", "blip"));
    const audio = audioOf(scene);
    const finished = next(audio, "ended");
    await playFrom(scene);
    expect(plays(scene)).toEqual(buildSingle("integer", 1));
    await finished;
    await playFrom(scene);
    expect(plays(scene)).toEqual(buildSingle("integer", 2));
    expect(scene.find(".ak-media-status").textContent).toBe("Plays 2.");
  });

  it("counts from the response that the host restored, and stops at max-plays", async (context) => {
    await needsPlaybackToEnd(context);
    const scene = mountScene(DECLARATION, BODY('max-plays="2"', "blip"));
    scene.setValue("R", buildSingle("integer", 1));
    expect(scene.find(".ak-media-status").textContent).toBe("Plays 1 / 2.");
    const finished = next(audioOf(scene), "ended");
    await playFrom(scene);
    expect(plays(scene)).toEqual(buildSingle("integer", 2));
    await finished;
    expect(scene.find(".ak-media-status").textContent).toBe("Plays 2 / 2. No plays left.");
    await userEvent.click(button(scene, "Play"));
    expect(scene.find(".ak-media-notice").textContent).toBe("No plays left.");
    expect(scene.find(".ak-media-notice").getAttribute("role")).toBe("status");
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.responses).toHaveLength(1);
  });

  it("does not let a reload start the count again: a restored count at max-plays cannot be played", async () => {
    const scene = mountScene(DECLARATION, BODY('max-plays="1"', "blip"));
    scene.setValue("R", buildSingle("integer", 1));
    await userEvent.click(button(scene, "Play"));
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.responses).toEqual([]);
  });

  it("plays again by itself when it loops, up to max-plays", async (context) => {
    await needsPlaybackToEnd(context);
    const scene = mountScene(DECLARATION, BODY('loop="true" max-plays="2"', "blip"));
    const audio = audioOf(scene);
    // The element listens before the test does, so that it has decided about a third play when the second ends.
    const secondEnd = new Promise<void>((done) => {
      let ends = 0;
      audio.addEventListener("ended", () => {
        ends += 1;
        if (ends === 2) done();
      });
    });
    await userEvent.click(button(scene, "Play"));
    await secondEnd;
    expect(plays(scene)).toEqual(buildSingle("integer", 2));
    expect(idle(audio)).toBe(true);
  });

  it("tells the candidate to play more when min-plays is not reached", async () => {
    const scene = mountScene(DECLARATION, BODY('min-plays="2"', "blip"));
    await playFrom(scene);
    expect(scene.find(".ak-hint").textContent).toBe("Play at least 2.");
  });

  it("shows the controls that the item asks for, and play always", () => {
    const only = mountScene(DECLARATION, BODY('data-qti-media-player-controls="rewind"'));
    expect(only.findAll(".ak-media-bar button").map((control) => control.textContent)).toEqual([
      "Play",
      "Back to start",
    ]);
    const none = mountScene(DECLARATION, BODY('data-qti-media-player-controls="none"'));
    expect(none.findAll(".ak-media-bar button").map((control) => control.textContent)).toEqual(["Play"]);
    const standard = mountScene(DECLARATION, BODY('data-qti-media-player-controls="default"'));
    expect(standard.findAll(".ak-media-bar button")).toHaveLength(3);
  });

  it("turns the captions on and off, and takes the player back to its start", async () => {
    const scene = mountScene(DECLARATION, BODY(""));
    const [track] = audioOf(scene).textTracks;
    expect(track?.mode).not.toBe("showing");
    await userEvent.click(button(scene, "Captions"));
    expect(track?.mode).toBe("showing");
    expect(button(scene, "Captions").getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(button(scene, "Captions"));
    expect(track?.mode).toBe("hidden");
    audioOf(scene).currentTime = 1;
    await userEvent.click(button(scene, "Back to start"));
    expect(audioOf(scene).currentTime).toBe(0);
  });

  it("waits for the pause delay before playback starts, in either spelling of the attribute", async () => {
    holdTimers();
    for (const attribute of ["data-qti-media-player-pause-delay", "qti-media-player-pause-delay"]) {
      const scene = mountScene(DECLARATION, BODY(`${attribute}="1.5"`));
      const audio = audioOf(scene);
      const notice = scene.find(".ak-media-notice");
      await userEvent.click(button(scene, "Play"));
      expect(notice.textContent, attribute).toBe("Playback starts in a moment.");
      expect(idle(audio), attribute).toBe(true);
      expect(button(scene, "Pause").textContent).toBe("Pause");
      vi.advanceTimersByTime(1499);
      expect(idle(audio), attribute).toBe(true);
      const started = next(audio, "playing");
      vi.advanceTimersByTime(1);
      await started;
      // The notice stays until playback has started.
      expect(notice.textContent, attribute).toBe("");
      expect(playing(audio), attribute).toBe(true);
      audio.pause();
      scene.host.remove();
    }
  });

  it("waits for a pause delay longer than a timer takes, where the timer of the browser would fire at once", async () => {
    holdTimers();
    const scene = mountScene(DECLARATION, BODY('data-qti-media-player-pause-delay="3000000"'));
    await userEvent.click(button(scene, "Play"));
    vi.advanceTimersByTime(1000);
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.find(".ak-media-notice").textContent).toBe("Playback starts in a moment.");
  });

  it("cancels a start that waits for its delay when the candidate presses pause", async () => {
    holdTimers();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    const scene = mountScene(DECLARATION, BODY('data-qti-media-player-pause-delay="1.5"'));
    await userEvent.click(button(scene, "Play"));
    await userEvent.click(button(scene, "Pause"));
    vi.advanceTimersByTime(2000);
    expect(play).not.toHaveBeenCalled();
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.responses).toEqual([]);
  });

  it("lets the candidate pause as often as the pause count says in one play, and then keeps playing", async () => {
    const scene = mountScene(DECLARATION, BODY('qti-media-player-pause-count="1"'));
    await playFrom(scene);
    await userEvent.click(button(scene, "Pause"));
    expect(idle(audioOf(scene))).toBe(true);
    await playFrom(scene, "play");
    await userEvent.click(button(scene, "Pause"));
    expect(playing(audioOf(scene))).toBe(true);
    expect(scene.find(".ak-media-notice").textContent).toBe("You cannot pause again.");
    expect(plays(scene)).toEqual(buildSingle("integer", 1));
    audioOf(scene).pause();
  });

  it("ends a pause by itself after the pause duration", async () => {
    holdTimers();
    const scene = mountScene(DECLARATION, BODY('data-qti-media-player-pause-duration="1.5"'));
    const audio = audioOf(scene);
    await playFrom(scene);
    await userEvent.click(button(scene, "Pause"));
    expect(idle(audio)).toBe(true);
    expect(scene.find(".ak-media-notice").textContent).toBe("Playback continues by itself.");
    vi.advanceTimersByTime(1499);
    expect(idle(audio)).toBe(true);
    const resumed = next(audio, "play");
    vi.advanceTimersByTime(1);
    await resumed;
    expect(playing(audio)).toBe(true);
    audio.pause();
  });

  it("ignores a pause attribute that is not a number of seconds above zero", async () => {
    const scene = mountScene(
      DECLARATION,
      BODY(
        'data-qti-media-player-pause-delay="soon" data-qti-media-player-pause-count="0" qti-media-player-pause-duration="-1"',
      ),
    );
    await playFrom(scene);
    await userEvent.click(button(scene, "Pause"));
    await userEvent.click(button(scene, "Play"));
    await userEvent.click(button(scene, "Pause"));
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.find(".ak-media-notice").textContent).toBe("");
  });

  it("keeps the controls of a recording that starts by itself, and starts it once", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    const scene = mountScene(DECLARATION, BODY("").replace('autostart="false"', 'autostart="true"'));
    await new Promise<void>((done) => queueMicrotask(done));
    expect(play).toHaveBeenCalledTimes(1);
    expect(scene.findAll(".ak-media-bar button").length).toBeGreaterThan(0);
    scene.setValue("R", buildSingle("integer", 1));
    expect(play).toHaveBeenCalledTimes(1);
    audioOf(scene).pause();
    play.mockRestore();
  });

  it("does not start a recording by itself when the candidate already played it", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    const scene = mountScene(DECLARATION, BODY("").replace('autostart="false"', 'autostart="true"'), {
      describe: false,
    });
    scene.setValue("R", buildSingle("integer", 1));
    scene.interaction().descriptor =
      scene.descriptors.get("R") ??
      (() => {
        throw new Error("no descriptor");
      })();
    await new Promise<void>((done) => queueMicrotask(done));
    expect(play).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it("stops the recording and locks the controls while the candidate cannot respond", async () => {
    const scene = mountScene(DECLARATION, BODY(""));
    await playFrom(scene);
    scene.interaction().disabled = true;
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.findAll<HTMLButtonElement>(".ak-media-bar button").every(({ disabled }) => disabled)).toBe(true);
  });

  it("draws no controls where media are withheld, and does not fail", () => {
    const scene = mountScene(DECLARATION, BODY(""), { withholdMedia: true });
    expect(scene.root.querySelector("audio, .ak-media-bar")).toBeNull();
    expect(scene.find("qti-prompt").textContent).toBe("Listen to the tone.");
  });
});

describe("followPlayback", () => {
  const elements: HTMLElement[] = [];
  afterEach(() => {
    for (const element of elements.splice(0)) element.remove();
  });

  /** Makes an audio element over the tone of the fixtures, which lasts two seconds, with the controls of the browser. */
  async function recording(): Promise<HTMLAudioElement> {
    const audio = document.createElement("audio");
    // The fixture server does not answer range requests, and a recording it serves cannot be sought in; a blob can.
    const bytes = await (await fetch(`${ASSETS}items/q1/media/tone.wav`)).blob();
    audio.src = URL.createObjectURL(bytes);
    audio.setAttribute("controls", "");
    document.body.append(audio);
    elements.push(audio);
    audio.preload = "auto";
    if (audio.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
      await new Promise((done) => audio.addEventListener("canplaythrough", done, { once: true }));
    }
    return audio;
  }

  it("plays, pauses and seeks the companion with the recording", async (context) => {
    await needsPlaybackToEnd(context);
    const [primary, companion] = [await recording(), await recording()];
    followPlayback(primary, companion);
    await userEvent.click(document.body);
    await primary.play();
    await waitFor(() => expect(companion.paused).toBe(false));
    primary.pause();
    await waitFor(() => expect(companion.paused).toBe(true));
    primary.currentTime = 1.5;
    await waitFor(() => expect(Math.abs(companion.currentTime - 1.5)).toBeLessThan(0.35));
  });

  it("changes the speed of the companion with the recording", async () => {
    const [primary, companion] = [await recording(), await recording()];
    followPlayback(primary, companion);
    primary.playbackRate = 1.5;
    await waitFor(() => expect(companion.playbackRate).toBe(1.5));
  });

  it("takes the controls and the sound from the companion while it follows, and gives them back", async () => {
    const [primary, companion] = [await recording(), await recording()];
    companion.muted = false;
    const release = followPlayback(primary, companion);
    expect([companion.hasAttribute("controls"), companion.muted]).toEqual([false, true]);
    release();
    expect([companion.hasAttribute("controls"), companion.muted]).toEqual([true, false]);
  });

  it("leaves a companion that was muted muted, and one without controls without them", async () => {
    const [primary, companion] = [await recording(), await recording()];
    companion.muted = true;
    companion.removeAttribute("controls");
    followPlayback(primary, companion)();
    expect([companion.hasAttribute("controls"), companion.muted]).toEqual([false, true]);
  });

  it("stops following when it is let go", async (context) => {
    await needsPlaybackToEnd(context);
    const [primary, companion] = [await recording(), await recording()];
    const release = followPlayback(primary, companion);
    release();
    await userEvent.click(document.body);
    await primary.play();
    await new Promise((done) => setTimeout(done, 300));
    expect(companion.paused).toBe(true);
    primary.pause();
  });
});

describe("Playback", () => {
  /**
   * An audio element at the end of a recording as WebKit reports it: `ended` is true while `paused` is still false, and
   * the `pause` and `ended` events are yet to come. `play` and `pause` do what the specification says: `play` on a
   * recording that is not paused sends no `play` and `playing` events.
   */
  function endingRecording(maxPlays: number | undefined) {
    const audio = document.createElement("audio");
    const state = { paused: true, ended: false };
    Object.defineProperties(audio, { paused: { get: () => state.paused }, ended: { get: () => state.ended } });
    const play = vi.spyOn(audio, "play").mockImplementation(() => {
      if (state.paused) {
        state.paused = false;
        state.ended = false;
        audio.dispatchEvent(new Event("play"));
        audio.dispatchEvent(new Event("playing"));
      }
      return Promise.resolve();
    });
    vi.spyOn(audio, "pause").mockImplementation(() => {
      if (state.paused) return;
      state.paused = true;
      audio.dispatchEvent(new Event("pause"));
    });
    const counted = { plays: 0, notices: [] as (PlaybackNotice | undefined)[] };
    const playback = new Playback(
      audio,
      { maxPlays: () => maxPlays, loop: false, pauseDelay: undefined, pauseDuration: undefined, pauseCount: undefined },
      {
        plays: () => counted.plays,
        started: () => {
          counted.plays += 1;
        },
        notify: (notice) => counted.notices.push(notice),
        changed: () => undefined,
      },
    );
    const reachEnd = (): void => {
      state.ended = true;
      audio.dispatchEvent(new Event("timeupdate"));
    };
    return { playback, play, counted, reachEnd };
  }

  it("counts a play that starts after the recording has ended and before the page has its ended event", () => {
    const { playback, counted, reachEnd } = endingRecording(undefined);
    playback.play();
    expect(counted.plays).toBe(1);
    reachEnd();
    expect(playback.playing).toBe(false);
    playback.play();
    expect(counted.plays).toBe(2);
    expect(playback.playing).toBe(true);
  });

  it("stops at max-plays a play that starts after the recording has ended and before its ended event", () => {
    const { playback, play, counted, reachEnd } = endingRecording(1);
    playback.play();
    reachEnd();
    expect(playback.exhausted).toBe(true);
    playback.play();
    expect(play).toHaveBeenCalledTimes(1);
    expect(counted.plays).toBe(1);
    expect(counted.notices.at(-1)).toBe("no-plays");
  });
});
