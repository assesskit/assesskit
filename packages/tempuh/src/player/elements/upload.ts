import type { UploadInteraction } from "@luthfanwakan/olah/asi";
import { checkResponse, type InteractionDescriptor } from "@luthfanwakan/olah/interactions";
import { type FileValue, type Primitive, single } from "@luthfanwakan/olah/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html, uniqueId } from "../dom.js";
import { chooseRecording, type Recording, type RecordingMethod, startRecording } from "../recording/recorder.js";
import { createInteraction, InteractionElement } from "./element.js";
import { violationText } from "./hints.js";
import { Notes } from "./notes.js";
import type { InteractionFiles } from "./options.js";
import { nameByPrompt, type RenderedPrompt, renderPrompt } from "./parts.js";
import { primitivesOf } from "./values.js";

/** The extension of a file name for each type that a recording is made in. */
const EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/wav", "wav"],
  ["audio/wave", "wav"],
  ["audio/x-wav", "wav"],
]);

/** The type of a file that the browser gives no type for: arbitrary binary data (RFC 2046 §4.5.1). */
const UNKNOWN_TYPE = "application/octet-stream";

/** The reference that a file has while olah checks its type: the host has not given one yet. */
const PENDING_REFERENCE = "pending";

/** What the upload needs from the page besides the node. */
export interface UploadServices {
  /** Where files are kept. */
  readonly files: InteractionFiles;
  /** The URL of the recording worklet. */
  readonly workletUrl: string;
  /** Whether a recording is offered where the browser can make one. */
  readonly record: boolean;
}

/** Lets go of the microphone, so that the indicator of the browser that it is in use goes off. */
function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Returns the file that a value holds, or `undefined`. */
function fileOf(value: Primitive | undefined): FileValue | undefined {
  return typeof value === "object" && !Array.isArray(value) && "reference" in value ? value : undefined;
}

/**
 * The element of `qti-upload-interaction` (INFO §5.165): the candidate sends a file, or, where the interaction accepts an
 * audio type that the browser can record, makes a recording, and the response is the file, which the host keeps (olah
 * D7). A file of a type that the interaction does not accept is not sent; the element says which types it accepts. The
 * microphone is asked for only when the candidate presses Record, and a visible indicator shows while it records (tempuh
 * design §3).
 */
export class UploadInteractionElement extends InteractionElement {
  override readonly kind = "upload-interaction";
  readonly #status = html("div", { class: "tempuh-upload-status", role: "status" });
  readonly #stored = html("div", { class: "tempuh-stored" });
  #services: UploadServices | undefined;
  #prompt: RenderedPrompt | undefined;
  #controls: HTMLElement | undefined;
  #input: HTMLInputElement | undefined;
  #record: HTMLButtonElement | undefined;
  #stop: HTMLButtonElement | undefined;
  #recording: Recording | undefined;
  #method: RecordingMethod | undefined;
  #rejected = false;
  #busy = false;
  #shown: FileValue | undefined;
  #stale = true;

  /** Fills the element with the prompt of the node; the controls come when the descriptor is known. */
  build(node: UploadInteraction, renderer: BodyRenderer, services: UploadServices): void {
    this.#services = services;
    this.#prompt = renderPrompt(node.prompt, renderer);
    this.notes = new Notes();
    this.setAttribute("role", "group");
    nameByPrompt(this, this.#prompt);
    this.append(
      ...(this.#prompt === undefined ? [] : [this.#prompt.element]),
      this.#status,
      this.#stored,
      this.notes.element,
    );
  }

  protected override configure(descriptor: InteractionDescriptor, messages: Messages): void {
    const services = this.#services;
    if (services === undefined) return;
    const accepted = descriptor.constraints.mimeTypes;
    const id = uniqueId("tempuh-upload");
    const input = html("input", {
      type: "file",
      id,
      ...(accepted === undefined ? {} : { accept: accepted.join(",") }),
    });
    input.addEventListener("change", () => {
      const [file] = input.files ?? [];
      if (file !== undefined) void this.#send(file, file.type === "" ? UNKNOWN_TYPE : file.type, file.name);
    });
    this.#input = input;
    this.#method = services.record ? chooseRecording(accepted) : undefined;
    const buttons = this.#method === undefined ? [] : this.#recordButtons(messages);
    this.#controls?.remove();
    this.#stale = true;
    this.#controls = html(
      "div",
      { class: "tempuh-upload" },
      html("label", { for: id }, messages.uploadChoose),
      input,
      ...buttons,
    );
    this.#status.before(this.#controls);
  }

  protected override sync(_descriptor: InteractionDescriptor, messages: Messages): void {
    const file = fileOf(primitivesOf(this.value)[0]);
    const locked = this.disabled || this.#busy;
    if (this.#input) this.#input.disabled = locked || this.#recording !== undefined;
    if (this.#record) this.#record.disabled = locked || this.#recording !== undefined;
    if (this.#stop) this.#stop.disabled = this.disabled || this.#recording === undefined;
    if (this.disabled && this.#recording !== undefined) void this.#finish(false);
    this.#showStored(file, messages);
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

  /** Lets go of the microphone when the element leaves the page. */
  disconnectedCallback(): void {
    if (this.#recording !== undefined) void this.#finish(false);
  }

  #recordButtons(messages: Messages): HTMLButtonElement[] {
    const record = html("button", { type: "button" }, messages.uploadRecord);
    const stop = html("button", { type: "button", disabled: "" }, messages.uploadStopRecording);
    record.addEventListener("click", () => void this.#begin(messages));
    stop.addEventListener("click", () => void this.#finish(true));
    this.#record = record;
    this.#stop = stop;
    return [record, stop];
  }

  /** Asks for the microphone, which only a press of the candidate does, and starts to record. */
  async #begin(messages: Messages): Promise<void> {
    const method = this.#method;
    const services = this.#services;
    if (method === undefined || services === undefined || this.#recording !== undefined) return;
    this.#status.textContent = "";
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const microphone = stream;
      const started = await startRecording(microphone, method, services.workletUrl);
      this.#recording = {
        // The recorder ends first: a recorder whose tracks end under it stops by itself.
        stop: () => started.stop().finally(() => stopTracks(microphone)),
      };
      this.#status.textContent = messages.uploadRecording;
      this.#status.classList.add("tempuh-recording");
    } catch {
      // The microphone is let go of even when the recording could not start.
      if (stream !== undefined) stopTracks(stream);
      this.#status.textContent = messages.uploadNoMicrophone;
    }
    if (!this.isConnected) void this.#finish(false);
    this.refresh();
  }

  /** Ends the recording and sends it, or throws it away. */
  async #finish(keep: boolean): Promise<void> {
    const recording = this.#recording;
    const method = this.#method;
    if (recording === undefined || method === undefined) return;
    this.#recording = undefined;
    this.#status.classList.remove("tempuh-recording");
    this.#status.textContent = "";
    const blob = await recording.stop();
    this.refresh();
    if (keep) await this.#send(blob, method.mimeType, `recording.${EXTENSIONS.get(method.mimeType) ?? "bin"}`);
  }

  /** Sends a file to be kept, unless its type is not accepted, and gives the file as the response. */
  async #send(bytes: Blob, mimeType: string, fileName: string): Promise<void> {
    const descriptor = this.descriptor;
    const services = this.#services;
    const messages = this.messages;
    if (descriptor === undefined || services === undefined || messages === undefined) return;
    // The type is checked before the bytes travel: olah's rule says whether the interaction accepts it.
    const probe = single("file", { reference: PENDING_REFERENCE, mimeType, fileName });
    this.#rejected = checkResponse(descriptor, probe).reasons.includes("mime-type");
    if (this.#rejected) {
      this.refresh();
      return;
    }
    this.#busy = true;
    this.#status.textContent = messages.uploadUploading;
    this.refresh();
    try {
      const file = await services.files.upload(bytes, mimeType, fileName);
      this.#status.textContent = "";
      this.#busy = false;
      this.respond(single("file", file));
    } catch {
      this.#busy = false;
      this.#status.textContent = messages.uploadFailed;
      this.refresh();
    }
  }

  /** Shows the file that the response holds, with a player for a recording and the button that takes it away. */
  #showStored(file: FileValue | undefined, messages: Messages): void {
    const services = this.#services;
    const same = JSON.stringify(file) === JSON.stringify(this.#shown);
    if (!same || this.#stale) {
      this.#shown = file;
      this.#stale = false;
      this.#stored.replaceChildren(
        ...(file === undefined || services === undefined ? [] : this.#storedParts(file, services, messages)),
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
    return [html("span", { class: "tempuh-file-name" }, file.fileName ?? file.reference), ...player, remove];
  }
}

/** Renders a `qti-upload-interaction`. */
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
