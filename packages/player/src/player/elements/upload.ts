import type { UploadInteraction } from "@assesskit/runtime/asi";
import { type InteractionDescriptor, validateResponse } from "@assesskit/runtime/interactions";
import { buildSingle, type FileValue } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { clockText, html, replaceAll, uniqueId } from "../internal.js";
import { chooseRecording, type Recording, type RecordingMethod, startRecording } from "../recording/index.js";
import { createInteraction, InteractionElement } from "./element.js";
import { violationText } from "./hints.js";
import { Notes } from "./notes.js";
import type { InteractionFiles } from "./options.js";
import { nameByPrompt, type RenderedPrompt, renderPrompt } from "./parts.js";
import { MAX_RECORDING_SECONDS, type RecordAttributes, readRecordAttributes } from "./record-attributes.js";
import { fileOf } from "./values.js";

/** The extension of a file name for each type that a recording is made in. */
const EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/wav", "wav"],
  ["audio/wave", "wav"],
  ["audio/x-wav", "wav"],
]);

/** The type of a file that the browser gives no type for: arbitrary binary data. */
const UNKNOWN_TYPE = "application/octet-stream";

/** The reference that a file has while the runtime checks its type: the host has not given one yet. */
const PENDING_REFERENCE = "pending";

/** What the upload needs from the page besides the node. */
export interface UploadServices {
  /** Where files are kept. */
  readonly files: InteractionFiles;
  /** The URL of the recording worklet. */
  readonly workletUrl: string;
  /** Reports an error that a recording can only report. */
  readonly report: (error: unknown) => void;
}

/** How a recording is made and stored: the method of the browser and the two calls to the host's files. */
interface Recorder {
  readonly method: RecordingMethod;
  readonly reserve: NonNullable<InteractionFiles["reserve"]>;
  readonly fill: NonNullable<InteractionFiles["fill"]>;
}

/** The reservation and the microphone of a recording that is about to start. */
interface Prepared {
  readonly file: FileValue;
  readonly stream: MediaStream;
}

/** Why a recording could not be prepared: the message to show, none when the hint of the interaction says it, and the error to report. */
interface Failure {
  readonly key: "uploadFailed" | "uploadNoMicrophone" | "uploadNotStarted" | undefined;
  readonly error: unknown;
}

/** A recording that was asked for, a countdown or a press of Record, until it starts or is given up. */
interface Attempt {
  /** Whether the recording is starting, so that a second request does not start another. */
  going: boolean;
  /** The reservation and the microphone; `undefined` after the reason was shown. */
  readonly prepared: Promise<Prepared | undefined>;
}

/** The time between the ticks of a countdown, in milliseconds. */
const TICK_MS = 1000;

/** The attributes of an upload that asks for no recording. */
const NO_ATTRIBUTES: RecordAttributes = { start: undefined, limit: MAX_RECORDING_SECONDS, once: false };

/** Whether two file values name the same stored file. */
const sameFile = (a: FileValue | undefined, b: FileValue | undefined): boolean =>
  a !== undefined && b !== undefined && a.reference === b.reference;

/** Lets go of the microphone, so that the indicator of the browser that it is in use goes off. */
function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * The element of `qti-upload-interaction`: the candidate sends a file, or, where the interaction accepts an audio type that
 * the browser can record, makes a recording.
 *
 * @remarks
 * The response is the file, which the host keeps. A file of a type that the interaction does not accept is not sent; the
 * element says which types it accepts. A visible indicator shows while it records.
 *
 * A recording names its file as it starts: `files.reserve` gives the file value, which the response holds from then on, and
 * `files.fill` stores the bytes when the recording ends, however it ends: Stop, the limit, a lock of the interaction, Next,
 * the end of the item or of the mount. So a time limit that closes the item while the candidate speaks keeps the answer. The
 * stored file shows, with the player and Remove, once its bytes are stored.
 *
 * The attributes `data-ak-record-start`, `data-ak-record-limit` and `data-ak-record-once` ask for a recording that starts by
 * itself after a countdown, is limited, and cannot be redone. The reservation and the microphone are asked for when the
 * countdown starts, or at a press of Record, so that a refusal shows at once.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, upload interaction}
 */
export class UploadInteractionElement extends InteractionElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "upload-interaction";
  readonly #status = html("div", { class: "ak-upload-status", role: "status" });
  readonly #clockLabel = html("span");
  readonly #clockTime = html("time", { class: "ak-time" });
  readonly #clock = html("div", { class: "ak-upload-clock" }, this.#clockLabel, " ", this.#clockTime);
  readonly #stored = html("div", { class: "ak-stored" });
  /**
   * The line of the status, the clock and the stored file, which keeps the height of a button whether or not it holds
   * anything, so that what the upload writes after an action moves nothing that follows it.
   */
  readonly #result = html("div", { class: "ak-upload-result" }, this.#status, this.#clock, this.#stored);
  #services: UploadServices | undefined;
  #prompt: RenderedPrompt | undefined;
  #controls: HTMLElement | undefined;
  #input: HTMLInputElement | undefined;
  #record: HTMLButtonElement | undefined;
  #stop: HTMLButtonElement | undefined;
  #recorder: Recorder | undefined;
  #attributes = NO_ATTRIBUTES;
  /** The recording under way and the file it named. */
  #recording: Recording | undefined;
  #reserved: FileValue | undefined;
  /** The end of the recording under way, until its bytes are stopped. */
  #stopping: Promise<void> | undefined;
  /** The recording that was asked for and has not started. */
  #attempt: Attempt | undefined;
  /** The countdown to the start, or to the end, of a recording. */
  #ticker: ReturnType<typeof setInterval> | undefined;
  /** The file of a recording whose bytes are not stored yet; the stored part hides it. */
  #unfilled: FileValue | undefined;
  /** Whether a recording started in this element, which `data-ak-record-once` counts. */
  #spent = false;
  #armed = false;
  #scheduled = false;
  #rejected = false;
  #busy = false;
  #shown: FileValue | undefined;
  #stale = true;

  /**
   * Fills the element with the prompt of the node; the controls come when the descriptor is known.
   *
   * @param node - The interaction.
   * @param renderer - The renderer of content.
   * @param services - Where the file is stored, and how the browser records.
   */
  build(node: UploadInteraction, renderer: BodyRenderer, services: UploadServices): void {
    this.#services = services;
    this.#prompt = renderPrompt(node.prompt, renderer);
    this.notes = new Notes();
    this.#clock.hidden = true;
    this.setAttribute("role", "group");
    nameByPrompt(this, this.#prompt);
    this.append(...(this.#prompt === undefined ? [] : [this.#prompt.element]), this.#result, this.notes.element);
  }

  protected override configure(descriptor: InteractionDescriptor, messages: Messages): void {
    const services = this.#services;
    if (services === undefined) return;
    const accepted = descriptor.constraints.mimeTypes;
    const id = uniqueId("ak-upload");
    const input = html("input", {
      type: "file",
      id,
      ...(accepted === undefined ? {} : { accept: accepted.join(",") }),
    });
    input.addEventListener("change", () => {
      const [file] = input.files ?? [];
      // A browser fires no change for the file that the picker holds, so the picker lets go of it: the same file chosen
      // again after an upload that failed, or after Remove, is sent again. The stored file shows its name.
      input.value = "";
      if (file !== undefined) void this.#send(file, file.type === "" ? UNKNOWN_TYPE : file.type, file.name);
    });
    this.#input = input;
    this.#attributes = readRecordAttributes(this);
    const { reserve, fill } = services.files;
    // A recording is offered where the browser can make one and the host's files can name and store it.
    const method = reserve !== undefined && fill !== undefined ? chooseRecording(accepted) : undefined;
    this.#recorder =
      method === undefined || reserve === undefined || fill === undefined ? undefined : { method, reserve, fill };
    const buttons = this.#recorder === undefined ? [] : this.#recordButtons(messages);
    this.#controls?.remove();
    this.#stale = true;
    this.#controls = html(
      "div",
      { class: "ak-upload" },
      html("label", { for: id }, messages.uploadChoose),
      input,
      ...buttons,
    );
    this.#result.before(this.#controls);
  }

  protected override sync(_descriptor: InteractionDescriptor, messages: Messages): void {
    const file = fileOf(this.value);
    const recording = this.#recording !== undefined;
    // Once a recording has started, or a file is there, the candidate cannot replace it.
    const spent = this.#attributes.once && (this.#spent || file !== undefined);
    const locked = this.disabled || this.#busy || spent;
    if (this.#input) this.#input.disabled = locked || recording;
    if (this.#record) this.#record.disabled = locked || recording;
    if (this.#stop) this.#stop.disabled = this.disabled || !recording;
    if (this.disabled) {
      this.#abandon();
      void this.#end();
    }
    this.#showStored(file, messages);
    this.#schedule();
  }

  protected override controls(): readonly Element[] {
    return this.#input === undefined ? [] : [this.#input];
  }

  protected override extraHints(_messages: Messages): readonly string[] {
    const descriptor = this.descriptor;
    const messages = this.messages;
    return this.#rejected && descriptor !== undefined && messages !== undefined
      ? [violationText("mime-type", descriptor, messages)]
      : [];
  }

  /**
   * Resolves when the recording has stopped, which is at once when none is under way. A countdown or a start in progress
   * ends with nothing recorded. The bytes of a recording are stored behind it, so that the candidate never waits for the
   * upload.
   *
   * @returns A promise that resolves when the microphone is let go of and the bytes are on their way to the host.
   */
  override async settled(): Promise<void> {
    this.#abandon();
    await this.#end();
  }

  /** Arms the countdown of an element that is connected again. */
  connectedCallback(): void {
    this.#schedule();
  }

  /** Lets go of the microphone when the element leaves the page, and stores what was recorded. */
  disconnectedCallback(): void {
    this.#abandon();
    void this.#end();
  }

  #recordButtons(messages: Messages): HTMLButtonElement[] {
    const record = html("button", { type: "button" }, messages.uploadRecord);
    const stop = html("button", { type: "button", disabled: "" }, messages.uploadStopRecording);
    record.addEventListener("click", () => {
      this.#status.textContent = "";
      void this.#go();
    });
    stop.addEventListener("click", () => void this.#end());
    this.#record = record;
    this.#stop = stop;
    return [record, stop];
  }

  /** Waits a microtask, so that the host has set the descriptor, the response and `disabled`, and then arms the countdown. */
  #schedule(): void {
    if (this.#armed || this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#arm();
    });
  }

  /** Starts the countdown of an item that is shown with no response, once; with a response it starts nothing. */
  #arm(): void {
    const { start } = this.#attributes;
    const messages = this.messages;
    if (
      this.#armed ||
      start === undefined ||
      this.#recorder === undefined ||
      messages === undefined ||
      this.descriptor === undefined ||
      this.disabled ||
      !this.isConnected
    ) {
      return;
    }
    this.#armed = true;
    if (fileOf(this.value) !== undefined) return;
    this.#open();
    if (start === 0) {
      void this.#go();
      return;
    }
    this.#status.textContent = messages.uploadAutomatic;
    this.#count(start, messages.uploadStartsIn, () => void this.#go());
  }

  /** Asks the host to name the file and the browser for the microphone, and keeps the answer for the start. */
  #open(): Attempt | undefined {
    const recorder = this.#recorder;
    if (recorder === undefined) return undefined;
    if (this.#attempt !== undefined) return this.#attempt;
    const attempt: Attempt = {
      going: false,
      prepared: this.#prepare(recorder).then((result) => {
        if ("file" in result) return result;
        this.#fail(attempt, result);
        return undefined;
      }),
    };
    this.#attempt = attempt;
    return attempt;
  }

  /** Checks the type, reserves the file and gets the microphone, in that order. */
  async #prepare({ method, reserve }: Recorder): Promise<Prepared | Failure> {
    const fileName = `recording.${EXTENSIONS.get(method.mimeType) ?? "bin"}`;
    if (!this.#accepts(method.mimeType, fileName)) return { key: undefined, error: undefined };
    let file: FileValue;
    try {
      file = await reserve(method.mimeType, { fileName });
    } catch (error) {
      return { key: "uploadFailed", error };
    }
    try {
      return { file, stream: await navigator.mediaDevices.getUserMedia({ audio: true }) };
    } catch (error) {
      return { key: "uploadNoMicrophone", error };
    }
  }

  /** Shows why a recording could not be prepared and reports it; the attempt ends and Record stays. */
  #fail(attempt: Attempt, { key, error }: Failure): void {
    if (this.#attempt === attempt) {
      this.#attempt = undefined;
      this.#stopTicker();
    }
    const messages = this.messages;
    if (key !== undefined && messages !== undefined) {
      this.#status.textContent = messages[key];
      this.#services?.report(error);
    }
    this.refresh();
  }

  /** Starts the recording when the reservation and the microphone are there, and gives the reserved file as the response. */
  async #go(): Promise<void> {
    const services = this.#services;
    const recorder = this.#recorder;
    const messages = this.messages;
    if (services === undefined || recorder === undefined || messages === undefined || this.#recording !== undefined) {
      return;
    }
    const attempt = this.#open();
    if (attempt === undefined || attempt.going) return;
    attempt.going = true;
    this.#stopTicker();
    const prepared = await attempt.prepared;
    if (prepared === undefined) return;
    if (this.#attempt !== attempt) {
      stopTracks(prepared.stream);
      return;
    }
    let started: Recording;
    try {
      started = await startRecording(prepared.stream, recorder.method, services.workletUrl);
    } catch (error) {
      stopTracks(prepared.stream);
      this.#fail(attempt, { key: "uploadNotStarted", error });
      return;
    }
    // The recorder ends first: a recorder whose tracks end under it stops by itself.
    const recording: Recording = { stop: () => started.stop().finally(() => stopTracks(prepared.stream)) };
    if (this.#attempt !== attempt) {
      // Given up while it started: nothing was named, so nothing is kept.
      void recording.stop();
      return;
    }
    this.#attempt = undefined;
    this.#recording = recording;
    this.#reserved = prepared.file;
    this.#unfilled = prepared.file;
    this.#spent = true;
    this.#status.textContent = messages.uploadRecording;
    this.#status.classList.add("ak-recording");
    this.#count(this.#attributes.limit, messages.uploadTimeLeft, () => void this.#end());
    this.respond(buildSingle("file", prepared.file));
    for (const track of prepared.stream.getTracks()) {
      track.addEventListener("ended", () => this.#microphoneLost(recording, messages), { once: true });
    }
  }

  /** Ends a recording whose microphone went away, as when a headset is unplugged, and keeps what it holds. */
  #microphoneLost(recording: Recording, messages: Messages): void {
    if (this.#recording !== recording) return;
    void this.#end();
    this.#status.textContent = messages.uploadNoMicrophone;
  }

  /** Gives up a countdown, or a recording that has not started: the microphone is let go of and the reservation stays unfilled. */
  #abandon(): void {
    const attempt = this.#attempt;
    if (attempt === undefined) return;
    this.#attempt = undefined;
    this.#stopTicker();
    this.#status.textContent = "";
    void attempt.prepared.then((prepared) => {
      if (prepared !== undefined) stopTracks(prepared.stream);
    });
    this.refresh();
  }

  /**
   * Ends the recording under way, however it ends, and starts to store its bytes: the returned promise resolves when the
   * recorder has stopped and not when the host has the bytes.
   */
  #end(): Promise<void> {
    if (this.#stopping !== undefined) return this.#stopping;
    const recording = this.#recording;
    const file = this.#reserved;
    if (recording === undefined || file === undefined) return Promise.resolve();
    this.#recording = undefined;
    this.#reserved = undefined;
    this.#stopTicker();
    this.#status.classList.remove("ak-recording");
    this.#status.textContent = "";
    this.#stopping = recording
      .stop()
      .then(
        (bytes) => void this.#store(file, bytes),
        (error: unknown) => this.#lose(file, error),
      )
      .finally(() => {
        this.#stopping = undefined;
        this.refresh();
      });
    this.refresh();
    return this.#stopping;
  }

  /** Stores the bytes of a recording and shows its file; a store that fails loses the recording. */
  async #store(file: FileValue, bytes: Blob): Promise<void> {
    try {
      await this.#recorder?.fill(file, bytes);
    } catch (error) {
      this.#lose(file, error);
      return;
    }
    if (sameFile(this.#unfilled, file)) {
      this.#unfilled = undefined;
      this.refresh();
    }
  }

  /**
   * Handles a recording whose bytes did not reach the host. While the candidate can still act, the response goes and the
   * message says so, and Record is there unless the recording was once; after the lock, Next or the end of the mount only
   * the host's `onError` can be told, and the response names a file without bytes.
   */
  #lose(file: FileValue, error: unknown): void {
    if (sameFile(this.#unfilled, file)) this.#unfilled = undefined;
    const messages = this.messages;
    if (this.isConnected && !this.disabled && messages !== undefined) {
      if (sameFile(fileOf(this.value), file)) this.respond(null);
      this.#status.textContent = messages.uploadFailed;
    } else {
      this.#services?.report(error);
    }
    this.refresh();
  }

  /** Shows the clock of a countdown, which is not a live region: the status says it once. */
  #count(seconds: number, label: string, done: () => void): void {
    this.#stopTicker();
    let left = seconds;
    this.#clockLabel.textContent = label;
    this.#clockTime.textContent = clockText(left * TICK_MS);
    this.#clock.hidden = false;
    this.#ticker = setInterval(() => {
      left -= 1;
      this.#clockTime.textContent = clockText(left * TICK_MS);
      if (left <= 0) {
        this.#stopTicker();
        done();
      }
    }, TICK_MS);
  }

  #stopTicker(): void {
    clearInterval(this.#ticker);
    this.#ticker = undefined;
    this.#clock.hidden = true;
  }

  /** Whether the interaction accepts the type of a file; when it does not, the element says which types it accepts. */
  #accepts(mimeType: string, fileName: string): boolean {
    const descriptor = this.descriptor;
    if (descriptor === undefined) return false;
    // The type is checked before the bytes travel: the runtime's rule says whether the interaction accepts it.
    const probe = buildSingle("file", { reference: PENDING_REFERENCE, mimeType, fileName });
    this.#rejected = validateResponse(descriptor, probe).reasons.includes("mime-type");
    if (this.#rejected) this.refresh();
    return !this.#rejected;
  }

  /** Sends a file to be kept, unless its type is not accepted, and gives the file as the response. */
  async #send(bytes: Blob, mimeType: string, fileName: string): Promise<void> {
    const services = this.#services;
    const messages = this.messages;
    if (services === undefined || messages === undefined || !this.#accepts(mimeType, fileName)) return;
    this.#busy = true;
    this.#status.textContent = messages.uploadUploading;
    this.refresh();
    try {
      const file = await services.files.upload(bytes, mimeType, { fileName });
      this.#status.textContent = "";
      this.#busy = false;
      this.respond(buildSingle("file", file));
    } catch {
      this.#busy = false;
      this.#status.textContent = messages.uploadFailed;
      this.refresh();
    }
  }

  /**
   * Shows the file that the response holds, with a player for a recording and the button that takes it away: nothing for
   * the file of a recording whose bytes are not stored yet, which would play nothing.
   */
  #showStored(file: FileValue | undefined, messages: Messages): void {
    const services = this.#services;
    const visible = sameFile(file, this.#unfilled) ? undefined : file;
    const same = JSON.stringify(visible) === JSON.stringify(this.#shown);
    if (!same || this.#stale) {
      this.#shown = visible;
      this.#stale = false;
      replaceAll(
        this.#stored,
        visible === undefined || services === undefined ? [] : this.#storedParts(visible, services, messages),
      );
    }
    for (const button of this.#stored.querySelectorAll("button")) button.disabled = this.disabled;
  }

  #storedParts(file: FileValue, services: UploadServices, messages: Messages): HTMLElement[] {
    const remove = html("button", { type: "button" }, messages.uploadRemove);
    remove.addEventListener("click", () => {
      this.#rejected = false;
      this.respond(null);
    });
    const player = file.mimeType.startsWith("audio/")
      ? [html("audio", { controls: "", src: services.files.url(file) })]
      : [];
    return [
      html("span", { class: "ak-file-name" }, file.fileName ?? file.reference),
      ...player,
      ...(this.#attributes.once ? [] : [remove]),
    ];
  }
}

/**
 * Renders a `qti-upload-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @param services - Where the file is stored, and how the browser records.
 * @returns The element.
 */
export function renderUpload(
  node: UploadInteraction,
  renderer: BodyRenderer,
  messages: Messages,
  services: UploadServices,
): Element {
  const element = createInteraction(UploadInteractionElement, "qti-upload-interaction", node, renderer, messages);
  element.build(node, renderer, services);
  return element;
}
