import { userEvent } from "vitest/browser";

let contexts: Promise<boolean> | undefined;

/**
 * Whether an audio context starts within a second, which a recording of a stream needs. A sandbox without a sound device
 * has a context that never starts, so a test that records skips itself there and runs in the engines that have one.
 */
export function audioContextRuns(): Promise<boolean> {
  contexts ??= (async () => {
    // A browser starts an audio context only after a gesture of the person.
    await userEvent.click(document.body);
    const context = new AudioContext();
    await Promise.race([context.resume(), new Promise((done) => setTimeout(done, 1000))]);
    const running = context.state === "running";
    await context.close();
    return running;
  })();
  return contexts;
}

let playbacks: Promise<boolean> | undefined;

/**
 * Whether audio plays to its end in the markup the player uses, an `audio` element with a `source`, which the counting
 * of plays needs. A sandbox without a sound device can leave playback where it started, so a test that plays to the end
 * skips itself there.
 */
export function audioPlaysToEnd(url: string): Promise<boolean> {
  playbacks ??= (async () => {
    await userEvent.click(document.body);
    const audio = document.createElement("audio");
    const source = document.createElement("source");
    source.src = url;
    audio.append(source);
    document.body.append(audio);
    await audio.play().catch(() => undefined);
    await new Promise((done) => setTimeout(done, 1500));
    const ended = audio.ended;
    audio.remove();
    return ended;
  })();
  return playbacks;
}
