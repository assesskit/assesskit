import type { MediaInteraction } from "@assesskit/runtime/asi";
import type { InteractionDescriptor } from "@assesskit/runtime/interactions";
import { single } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { html } from "../internal.js";
import {
  CAPTION_KINDS,
  DESCRIPTION_KINDS,
  isShowing,
  type MediaSettings,
  Playback,
  type PlaybackNotice,
  type PlaybackRules,
  readMediaSettings,
  tracksOf,
} from "../media/index.js";
import { createInteraction, InteractionElement } from "./element.js";
import { Notes } from "./notes.js";
import { elementsNamed, nameByPrompt, renderPrompt } from "./parts.js";
import { primitivesOf } from "./values.js";

const SECONDS_PER_MINUTE = 60;

/** Returns a time as minutes and seconds: `1:05`. */
function clock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  return `${Math.floor(whole / SECONDS_PER_MINUTE)}:${String(whole % SECONDS_PER_MINUTE).padStart(2, "0")}`;
}

/** The controls of the player and what they show. */
interface Bar {
  readonly element: HTMLElement;
  readonly play: HTMLButtonElement;
  readonly rewind: HTMLButtonElement | undefined;
  readonly captions: HTMLButtonElement | undefined;
  readonly description: HTMLButtonElement | undefined;
  readonly status: HTMLElement;
  readonly time: HTMLElement;
  readonly notice: HTMLElement;
}

/**
 * The element of `qti-media-interaction`: an audio or video object that the candidate plays, and the number of times
 * they did is the response (an integer).
 *
 * @remarks
 * The element draws the controls itself, so that the rules can hold: play and pause, and, as the item asks, going back
 * to the start, captions and audio description. The recording stops at `max-plays`, and the count is the response that
 * the host restored, never the element's own. The pause attributes of the item are kept ({@link Playback}).
 *
 * A recording that starts by itself (`autostart`) starts only while the candidate has played it no time, and, as
 * browsers allow, without a gesture; the controls stay, so that the candidate can pause it (WCAG 1.4.2).
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, media interaction}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/vocab/ | QTI 3 Standardized Shared Vocabulary, media interaction}
 */
export class MediaInteractionElement extends InteractionElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "media-interaction";
  #node: MediaInteraction | undefined;
  #media: HTMLMediaElement | undefined;
  #settings: MediaSettings | undefined;
  #playback: Playback | undefined;
  #bar: Bar | undefined;
  #started = false;
  #notice: PlaybackNotice | undefined;

  /**
   * Fills the element with the prompt and the recording of the node.
   *
   * @param node - The interaction.
   * @param renderer - The renderer of content.
   */
  build(node: MediaInteraction, renderer: BodyRenderer): void {
    this.#node = node;
    const prompt = renderPrompt(node.prompt, renderer);
    const rendered = renderer.nodes([node.media]);
    const media = [...elementsNamed(rendered, "audio"), ...elementsNamed(rendered, "video")][0];
    if (media instanceof HTMLMediaElement) {
      // The player draws the controls, so that the rules of the item hold.
      media.removeAttribute("controls");
      this.#media = media;
      // Other parts change the tracks too, such as the captions of a candidate's supports: the buttons show the mode.
      media.textTracks.addEventListener("change", () => this.#refresh());
    }
    this.#settings = readMediaSettings(node);
    this.notes = new Notes();
    this.setAttribute("role", "group");
    nameByPrompt(this, prompt);
    this.append(...(prompt === undefined ? [] : [prompt.element]), ...rendered, this.notes.element);
  }

  protected override configure(_descriptor: InteractionDescriptor, messages: Messages): void {
    const media = this.#media;
    const settings = this.#settings;
    const node = this.#node;
    if (media === undefined || settings === undefined || node === undefined) return;
    this.#bar?.element.remove();
    const bar = this.#makeBar(media, settings, messages);
    this.#bar = bar;
    this.notes?.element.before(bar.element);
    this.#playback ??= new Playback(media, this.#rules(settings, node), {
      plays: () => this.#plays(),
      started: () => this.respond(single("integer", this.#plays() + 1)),
      notify: (notice) => {
        this.#notice = notice;
        this.#refresh();
      },
      changed: () => this.#refresh(),
    });
    if (node.autostart && !this.#started && this.#plays() === 0 && !this.disabled) {
      this.#started = true;
      queueMicrotask(() => {
        if (this.isConnected) this.#playback?.play();
      });
    }
  }

  protected override sync(): void {
    if (this.disabled) this.#playback?.stop();
    this.#refresh();
  }

  /** Stops the recording and every wait when the element leaves the page. */
  disconnectedCallback(): void {
    this.#playback?.stop();
  }

  /** Returns how many times the recording was played: the response that the element holds. */
  #plays(): number {
    const [plays] = primitivesOf(this.value);
    return typeof plays === "number" ? plays : 0;
  }

  #rules(settings: MediaSettings, node: MediaInteraction): PlaybackRules {
    return {
      // max-plays comes from the descriptor, which the host can set after the element is built.
      maxPlays: () => this.descriptor?.constraints.maxPlays,
      loop: node.loop === true,
      pauseDelay: settings.pauseDelay,
      pauseDuration: settings.pauseDuration,
      pauseCount: settings.pauseCount,
    };
  }

  #makeBar(media: HTMLMediaElement, settings: MediaSettings, messages: Messages): Bar {
    const button = (label: string, run: () => void): HTMLButtonElement => {
      const control = html("button", { type: "button" }, label);
      control.addEventListener("click", run);
      return control;
    };
    const toggle = (kinds: readonly string[], label: string): HTMLButtonElement | undefined => {
      const tracks = tracksOf(media, kinds);
      if (tracks.length === 0) return undefined;
      const control = button(label, () => {
        const showing = control.getAttribute("aria-pressed") !== "true";
        for (const track of tracks) track.mode = showing ? "showing" : "hidden";
        control.setAttribute("aria-pressed", String(showing));
      });
      control.setAttribute("aria-pressed", String(isShowing(tracks)));
      return control;
    };
    const play = button(messages.mediaPlay, () => {
      if (this.#playback?.playing || this.#playback?.waiting) this.#playback.pause();
      else this.#playback?.play();
    });
    const rewind = settings.controls.has("rewind")
      ? button(messages.mediaRewind, () => this.#playback?.rewind())
      : undefined;
    const captions = settings.controls.has("captions") ? toggle(CAPTION_KINDS, messages.mediaCaptions) : undefined;
    const description = settings.controls.has("audioDescription")
      ? toggle(DESCRIPTION_KINDS, messages.mediaAudioDescription)
      : undefined;
    const status = html("span", { class: "ak-media-status" });
    const time = html("span", { class: "ak-media-time" });
    const notice = html("span", { class: "ak-media-notice", role: "status" });
    const buttons = [play, rewind, captions, description].filter((control) => control !== undefined);
    const element = html(
      "div",
      { class: "ak-media-bar", role: "group", "aria-label": messages.mediaPlayer },
      ...buttons,
      status,
      time,
      notice,
    );
    return { element, play, rewind, captions, description, status, time, notice };
  }

  /** Shows the state of the player: the buttons, the plays, the time and what the candidate waits for. */
  #refresh(): void {
    const { descriptor, messages } = this;
    const bar = this.#bar;
    const playback = this.#playback;
    const media = this.#media;
    if (bar === undefined || playback === undefined || media === undefined || messages === undefined) return;
    const busy = playback.playing || playback.waiting;
    bar.play.textContent = busy ? messages.mediaPause : messages.mediaPlay;
    for (const control of [bar.play, bar.rewind, bar.captions, bar.description]) {
      if (control !== undefined) control.disabled = this.disabled;
    }
    bar.captions?.setAttribute("aria-pressed", String(isShowing(tracksOf(media, CAPTION_KINDS))));
    bar.description?.setAttribute("aria-pressed", String(isShowing(tracksOf(media, DESCRIPTION_KINDS))));
    const max = descriptor?.constraints.maxPlays;
    const left = playback.exhausted && !busy ? ` ${messages.mediaNoPlaysLeft}` : "";
    bar.status.textContent = `${messages.mediaPlays} ${this.#plays()}${max === undefined ? "" : ` / ${max}`}.${left}`;
    bar.time.textContent = `${clock(media.currentTime)} / ${clock(media.duration)}`;
    const notices = new Map<PlaybackNotice, string>([
      ["no-pauses", messages.mediaNoPauses],
      ["no-plays", messages.mediaNoPlaysLeft],
      ["resumes", messages.mediaResumes],
      ["starts-soon", messages.mediaStartsSoon],
    ]);
    const notice = this.#notice === undefined ? "" : (notices.get(this.#notice) ?? "");
    if (bar.notice.textContent !== notice) bar.notice.textContent = notice;
  }
}

/**
 * Renders a `qti-media-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns The element.
 */
export function renderMedia(node: MediaInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(MediaInteractionElement, "qti-media-interaction", node, renderer, messages);
  element.build(node, renderer);
  return element;
}
