import { single } from "@luthfanwakan/olah/values";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { audioPlaysToEnd } from "./audio.js";
import { ASSETS, mountScene, type Scene } from "./interactions-fixture.js";
import { axeViolations } from "./renderer-fixture.js";

const DECLARATION = `<qti-response-declaration identifier="R" cardinality="single" base-type="integer"/>`;

/** A media interaction over the tone of the fixtures, which lasts two seconds, with captions. */
const BODY = (
  attributes: string,
  source = "tone",
): string => `<qti-media-interaction response-identifier="R" autostart="false" ${attributes}>
  <qti-prompt>Listen to the tone.</qti-prompt>
  <audio><source src="media/${source}.wav" type="audio/wav"/><track kind="captions" src="media/captions.vtt" srclang="en" label="English"/></audio>
</qti-media-interaction>`;

/** Skips a test that plays a recording to its end where the engine cannot: a sandbox without a sound device. */
async function needsPlaybackToEnd(context: { skip(): never }): Promise<void> {
  if (!(await audioPlaysToEnd(`${ASSETS}items/q1/media/blip.wav`))) context.skip();
}

const audioOf = (scene: Scene): HTMLAudioElement => scene.find<HTMLAudioElement>("audio");
const button = (scene: Scene, name: string): HTMLButtonElement =>
  scene.findAll<HTMLButtonElement>(".tempuh-media-bar button").find(({ textContent }) => textContent === name) ??
  scene.find("none");
const plays = (scene: Scene): unknown => scene.responses.at(-1)?.value;
/** Whether a recording is not playing: it is paused, or, in browsers that do not pause it, it has ended. */
const idle = (audio: HTMLAudioElement): boolean => audio.paused || audio.ended;
const playing = (audio: HTMLAudioElement): boolean => !idle(audio);

describe("media", () => {
  it("[T42] draws the controls of the player in place of the controls of the browser, named by the prompt", async () => {
    const scene = mountScene(DECLARATION, BODY(""));
    expect(audioOf(scene).hasAttribute("controls")).toBe(false);
    expect(scene.findAll(".tempuh-media-bar button").map((control) => control.textContent)).toEqual([
      "Play",
      "Back to start",
      "Captions",
    ]);
    expect(scene.find(".tempuh-media-bar").getAttribute("aria-label")).toBe("Media player");
    expect(scene.interaction().getAttribute("aria-labelledby")).toBe(scene.find("qti-prompt").id);
    expect(scene.find(".tempuh-media-status").textContent).toBe("Plays 0.");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[T42] gives the number of plays as the response, one for each time playback starts from the start", async (context) => {
    await needsPlaybackToEnd(context);
    const scene = mountScene(DECLARATION, BODY("", "blip"));
    await userEvent.click(button(scene, "Play"));
    await vi.waitFor(() => expect(plays(scene)).toEqual(single("integer", 1)));
    await vi.waitFor(() => expect(button(scene, "Play")).toBeDefined(), { timeout: 3000 });
    await userEvent.click(button(scene, "Play"));
    await vi.waitFor(() => expect(plays(scene)).toEqual(single("integer", 2)));
    expect(scene.find(".tempuh-media-status").textContent).toBe("Plays 2.");
  });

  it("[T42] counts from the response that the host restored, and stops at max-plays", async (context) => {
    await needsPlaybackToEnd(context);
    const scene = mountScene(DECLARATION, BODY('max-plays="2"', "blip"));
    scene.setValue("R", single("integer", 1));
    expect(scene.find(".tempuh-media-status").textContent).toBe("Plays 1 / 2.");
    await userEvent.click(button(scene, "Play"));
    await vi.waitFor(() => expect(plays(scene)).toEqual(single("integer", 2)));
    await vi.waitFor(() => expect(scene.find(".tempuh-media-status").textContent).toBe("Plays 2 / 2. No plays left."), {
      timeout: 3000,
    });
    await userEvent.click(button(scene, "Play"));
    expect(scene.find(".tempuh-media-notice").textContent).toBe("No plays left.");
    expect(scene.find(".tempuh-media-notice").getAttribute("role")).toBe("status");
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.responses).toHaveLength(1);
  });

  it("[T42] does not let a reload start the count again: a restored count at max-plays cannot be played", async () => {
    const scene = mountScene(DECLARATION, BODY('max-plays="1"', "blip"));
    scene.setValue("R", single("integer", 1));
    await userEvent.click(button(scene, "Play"));
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.responses).toEqual([]);
  });

  it("[T42] plays again by itself when it loops, up to max-plays", async (context) => {
    await needsPlaybackToEnd(context);
    const scene = mountScene(DECLARATION, BODY('loop="true" max-plays="2"', "blip"));
    await userEvent.click(button(scene, "Play"));
    await vi.waitFor(() => expect(plays(scene)).toEqual(single("integer", 2)));
    await vi.waitFor(() => expect(idle(audioOf(scene))).toBe(true), { timeout: 3000 });
    await new Promise((done) => setTimeout(done, 300));
    expect(plays(scene)).toEqual(single("integer", 2));
  });

  it("[T42][T47][SC 3.3.3] tells the candidate to play more when min-plays is not reached", async () => {
    const scene = mountScene(DECLARATION, BODY('min-plays="2"', "blip"));
    await userEvent.click(button(scene, "Play"));
    await vi.waitFor(() => expect(scene.find(".tempuh-hint").textContent).toBe("Play at least 2."));
  });

  it("[T42] shows the controls that the item asks for, and play always", () => {
    const only = mountScene(DECLARATION, BODY('data-qti-media-player-controls="rewind"'));
    expect(only.findAll(".tempuh-media-bar button").map((control) => control.textContent)).toEqual([
      "Play",
      "Back to start",
    ]);
    const none = mountScene(DECLARATION, BODY('data-qti-media-player-controls="none"'));
    expect(none.findAll(".tempuh-media-bar button").map((control) => control.textContent)).toEqual(["Play"]);
    const standard = mountScene(DECLARATION, BODY('data-qti-media-player-controls="default"'));
    expect(standard.findAll(".tempuh-media-bar button")).toHaveLength(3);
  });

  it("[T42] turns the captions on and off, and takes the player back to its start", async () => {
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

  it("[T119] waits for the pause delay before playback starts, in either spelling of the attribute", async () => {
    for (const attribute of ["data-qti-media-player-pause-delay", "qti-media-player-pause-delay"]) {
      const scene = mountScene(DECLARATION, BODY(`${attribute}="1.5"`));
      await userEvent.click(button(scene, "Play"));
      expect(scene.find(".tempuh-media-notice").textContent, attribute).toBe("Playback starts in a moment.");
      expect(idle(audioOf(scene)), attribute).toBe(true);
      expect(button(scene, "Pause").textContent).toBe("Pause");
      // The notice stays until playback has started.
      await vi.waitFor(() => expect(scene.find(".tempuh-media-notice").textContent).toBe(""), { timeout: 5000 });
      expect(playing(audioOf(scene))).toBe(true);
      audioOf(scene).pause();
      scene.host.remove();
    }
  });

  it("[T119] cancels a start that waits for its delay when the candidate presses pause", async () => {
    const scene = mountScene(DECLARATION, BODY('data-qti-media-player-pause-delay="1.5"'));
    await userEvent.click(button(scene, "Play"));
    await userEvent.click(button(scene, "Pause"));
    await new Promise((done) => setTimeout(done, 2000));
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.responses).toEqual([]);
  });

  it("[T119] lets the candidate pause as often as the pause count says in one play, and then keeps playing", async () => {
    const scene = mountScene(DECLARATION, BODY('qti-media-player-pause-count="1"'));
    await userEvent.click(button(scene, "Play"));
    await vi.waitFor(() => expect(playing(audioOf(scene))).toBe(true));
    await userEvent.click(button(scene, "Pause"));
    expect(idle(audioOf(scene))).toBe(true);
    await userEvent.click(button(scene, "Play"));
    await vi.waitFor(() => expect(playing(audioOf(scene))).toBe(true));
    await userEvent.click(button(scene, "Pause"));
    expect(playing(audioOf(scene))).toBe(true);
    expect(scene.find(".tempuh-media-notice").textContent).toBe("You cannot pause again.");
    expect(plays(scene)).toEqual(single("integer", 1));
    audioOf(scene).pause();
  });

  it("[T119] ends a pause by itself after the pause duration", async () => {
    const scene = mountScene(DECLARATION, BODY('data-qti-media-player-pause-duration="1.5"'));
    await userEvent.click(button(scene, "Play"));
    await vi.waitFor(() => expect(playing(audioOf(scene))).toBe(true));
    await userEvent.click(button(scene, "Pause"));
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.find(".tempuh-media-notice").textContent).toBe("Playback continues by itself.");
    await vi.waitFor(() => expect(playing(audioOf(scene))).toBe(true), { timeout: 5000 });
    audioOf(scene).pause();
  });

  it("[T119] ignores a pause attribute that is not a number of seconds above zero", async () => {
    const scene = mountScene(
      DECLARATION,
      BODY(
        'data-qti-media-player-pause-delay="soon" data-qti-media-player-pause-count="0" qti-media-player-pause-duration="-1"',
      ),
    );
    await userEvent.click(button(scene, "Play"));
    await vi.waitFor(() => expect(playing(audioOf(scene))).toBe(true));
    await userEvent.click(button(scene, "Pause"));
    await userEvent.click(button(scene, "Play"));
    await userEvent.click(button(scene, "Pause"));
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.find(".tempuh-media-notice").textContent).toBe("");
  });

  it("[SC 1.4.2] keeps the controls of a recording that starts by itself, and starts it once", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    const scene = mountScene(DECLARATION, BODY("").replace('autostart="false"', 'autostart="true"'));
    await new Promise<void>((done) => queueMicrotask(done));
    expect(play).toHaveBeenCalledTimes(1);
    expect(scene.findAll(".tempuh-media-bar button").length).toBeGreaterThan(0);
    scene.setValue("R", single("integer", 1));
    expect(play).toHaveBeenCalledTimes(1);
    audioOf(scene).pause();
    play.mockRestore();
  });

  it("[T42] does not start a recording by itself when the candidate already played it", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    const scene = mountScene(DECLARATION, BODY("").replace('autostart="false"', 'autostart="true"'), {
      describe: false,
    });
    scene.setValue("R", single("integer", 1));
    scene.interaction().descriptor =
      scene.descriptors.get("R") ??
      (() => {
        throw new Error("no descriptor");
      })();
    await new Promise<void>((done) => queueMicrotask(done));
    expect(play).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it("[T42] stops the recording and locks the controls while the candidate cannot respond", async () => {
    const scene = mountScene(DECLARATION, BODY(""));
    await userEvent.click(button(scene, "Play"));
    await vi.waitFor(() => expect(playing(audioOf(scene))).toBe(true));
    scene.interaction().disabled = true;
    expect(idle(audioOf(scene))).toBe(true);
    expect(scene.findAll<HTMLButtonElement>(".tempuh-media-bar button").every(({ disabled }) => disabled)).toBe(true);
  });

  it("[T42] draws no controls where media are withheld, and does not fail", () => {
    const scene = mountScene(DECLARATION, BODY(""), { withholdMedia: true });
    expect(scene.root.querySelector("audio, .tempuh-media-bar")).toBeNull();
    expect(scene.find("qti-prompt").textContent).toBe("Listen to the tone.");
  });
});
