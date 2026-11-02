import { inject, vi } from "vitest";
import { userEvent } from "vitest/browser";

/**
 * The longest a sound device may take to start an audio context or to play a short recording to its end, in milliseconds.
 * A host with a device answers within a moment; one without never does, and this bound only ends that wait.
 */
const DEVICE_WAIT_MS = 10_000;

let contexts: Promise<boolean> | undefined;

/**
 * Whether an audio context starts, which a recording of a stream needs. A host without a sound device has a context that
 * never starts.
 */
export function audioContextRuns(): Promise<boolean> {
  contexts ??= (async () => {
    // A browser starts an audio context only after a gesture of the person.
    await userEvent.click(document.body);
    const context = new AudioContext();
    await Promise.race([context.resume(), new Promise((done) => setTimeout(done, DEVICE_WAIT_MS))]);
    const running = context.state === "running";
    await context.close();
    return running;
  })();
  return contexts;
}

let playbacks: Promise<boolean> | undefined;

/**
 * Whether audio plays to its end in the markup the player uses, an `audio` element with a `source`, which the counting
 * of plays needs. A host without a sound device can leave playback where it started.
 */
export function audioPlaysToEnd(url: string): Promise<boolean> {
  playbacks ??= (async () => {
    await userEvent.click(document.body);
    const audio = document.createElement("audio");
    const source = document.createElement("source");
    source.src = url;
    audio.append(source);
    document.body.append(audio);
    const ended = new Promise<boolean>((done) => {
      audio.addEventListener("ended", () => done(true), { once: true });
      setTimeout(() => done(false), DEVICE_WAIT_MS);
    });
    await audio.play().catch(() => undefined);
    const played = await ended;
    audio.remove();
    return played;
  })();
  return playbacks;
}

/**
 * Skips a test that needs a sound device when the host has none. A host that says it has one, with `REQUIRE_AUDIO=1`, fails
 * the test instead, so that a missing device cannot turn a test into a skip unseen.
 *
 * @param context - The context of the test.
 * @param available - What the probe of the device says, such as {@link audioContextRuns}.
 */
export async function needsAudio(context: { skip(): never }, available: Promise<boolean>): Promise<void> {
  if (await available) return;
  if (inject("requireAudio")) {
    throw new Error(
      "REQUIRE_AUDIO says that the host has a sound device, and the browser has no audio output that works.",
    );
  }
  context.skip();
}

const realSetTimeout = globalThis.setTimeout;

/** The audio contexts that the page made since {@link trackAudioContexts}, the ones of the code under test among them. */
const TRACKED: AudioContext[] = [];

/**
 * Starts to keep every audio context that the page makes, and forgets the ones kept before, so that {@link heardFor} can wait
 * for the sound that the code under test records, whichever context records it. A test that restores the globals after it
 * (`vi.unstubAllGlobals`) ends the tracking.
 */
export function trackAudioContexts(): void {
  TRACKED.length = 0;
  const Real = globalThis.AudioContext;
  vi.stubGlobal(
    "AudioContext",
    class extends Real {
      constructor(...options: ConstructorParameters<typeof Real>) {
        super(...options);
        TRACKED.push(this);
      }
    },
  );
}

/**
 * A stream of an oscillator, which a test gives in place of the microphone. It needs an audio context that runs, so a test
 * that uses it waits for {@link audioContextRuns} first. It returns once sound reaches the end of the context: a device that
 * has just been opened takes a while to start, and a recording made before that holds a header and no sound.
 */
export async function fakeMicrophone(): Promise<MediaStream> {
  const context = new AudioContext();
  await context.resume();
  const oscillator = context.createOscillator();
  const destination = context.createMediaStreamDestination();
  const analyser = context.createAnalyser();
  oscillator.connect(destination);
  oscillator.connect(analyser);
  oscillator.start();
  const samples = new Float32Array(analyser.fftSize);
  await new Promise<void>((flowing) => {
    const look = (): void => {
      analyser.getFloatTimeDomainData(samples);
      if (samples.some((sample) => sample !== 0)) flowing();
      else realSetTimeout(look, 20);
    };
    look();
  });
  return destination.stream;
}

/**
 * Resolves when every audio context that is running, the one of the microphone and the one that records it, has advanced the
 * seconds given by its own clock since the call. A busy host stalls the clock of a context, and a recording that was made
 * while the clock of its context stood still holds a header and no sound, however long a test waited in real time.
 *
 * @param seconds - How long the sound plays before the promise resolves.
 * @throws `Error` when no context is running, because the test did not call {@link trackAudioContexts} before the page made
 * one.
 */
export async function heardFor(seconds: number): Promise<void> {
  const running = TRACKED.filter(({ state }) => state === "running").map((context) => ({
    context,
    from: context.currentTime,
  }));
  if (running.length === 0) throw new Error("No audio context is running: call trackAudioContexts first.");
  await new Promise<void>((played) => {
    const look = (): void => {
      if (running.every(({ context, from }) => context.state !== "running" || context.currentTime - from >= seconds)) {
        played();
      } else {
        realSetTimeout(look, 20);
      }
    };
    look();
  });
}
