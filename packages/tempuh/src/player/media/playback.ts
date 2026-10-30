/** What the candidate is told while the player waits or refuses. */
export type PlaybackNotice = "no-pauses" | "no-plays" | "resumes" | "starts-soon";

/** What the player of a media interaction asks of its element. */
export interface PlaybackHost {
  /** Returns how many times the recording was played: the response the element holds. */
  plays(): number;
  /** Says that a new play started, which the element gives as the new count. */
  started(): void;
  /** Says what the candidate is waiting for, or that nothing is pending. */
  notify(notice: PlaybackNotice | undefined): void;
  /** Says that the state of the player changed. */
  changed(): void;
}

/** The rules that the item and the interaction give a player. */
export interface PlaybackRules {
  /** Returns the most plays, from `max-plays` (INFO §5.92.3); `undefined` for no limit. */
  maxPlays(): number | undefined;
  /** Whether the recording plays again when it ends, subject to `max-plays` (INFO §5.92.4). */
  readonly loop: boolean;
  /** The seconds to wait after the candidate presses play. */
  readonly pauseDelay: number | undefined;
  /** The seconds that a pause lasts. */
  readonly pauseDuration: number | undefined;
  /** The most pauses in one play. */
  readonly pauseCount: number | undefined;
}

/**
 * The rules of playing a recording in a media interaction (INFO §5.92, VOCAB §1.2.11). A play starts when playback begins
 * from the start, and not when it resumes after a pause; it is counted at the start, as the response says how many times
 * the candidate "experienced" the recording, and the count is the element's response, never the player's own. The
 * recording cannot be played more than `max-plays` times. The player also keeps the pause attributes: a delay before
 * playback starts or resumes, a duration after which a pause ends by itself, and a number of pauses for one play.
 */
export class Playback {
  readonly #media: HTMLMediaElement;
  readonly #rules: PlaybackRules;
  readonly #host: PlaybackHost;
  #fresh = true;
  #waiting = false;
  #pauses = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * @param media - The audio or video element, without the controls of the browser.
   * @param rules - The rules of the item.
   * @param host - The element that holds the count.
   */
  constructor(media: HTMLMediaElement, rules: PlaybackRules, host: PlaybackHost) {
    this.#media = media;
    this.#rules = rules;
    this.#host = host;
    // The player loops by itself, so that every round is a play that counts, and a loop stops at max-plays.
    media.loop = false;
    media.addEventListener("play", () => host.changed());
    media.addEventListener("playing", () => this.#onPlaying());
    media.addEventListener("pause", () => host.changed());
    media.addEventListener("timeupdate", () => host.changed());
    media.addEventListener("ended", () => this.#onEnded());
  }

  /** Whether the recording is playing. */
  get playing(): boolean {
    return !this.#media.paused && !this.#media.ended;
  }

  /** Whether playback has been asked for and waits for the delay. */
  get waiting(): boolean {
    return this.#waiting;
  }

  /** Whether another play can start: the recording is not at its limit of plays. */
  get exhausted(): boolean {
    const max = this.#rules.maxPlays();
    return this.#fresh && max !== undefined && this.#host.plays() >= max;
  }

  /** Whether the candidate can pause: the recording plays and the pauses of this play are not used up. */
  get pausable(): boolean {
    const { pauseCount } = this.#rules;
    return this.playing && (pauseCount === undefined || this.#pauses < pauseCount);
  }

  /** Starts or resumes playback, after the delay of the item. Does nothing while the recording plays or waits. */
  play(): void {
    if (this.playing || this.#waiting) return;
    if (this.exhausted) {
      this.#host.notify("no-plays");
      return;
    }
    this.#cancel();
    const delay = this.#rules.pauseDelay;
    if (delay === undefined) {
      this.#start();
      return;
    }
    this.#waiting = true;
    this.#host.notify("starts-soon");
    this.#timer = setTimeout(() => {
      this.#waiting = false;
      this.#start();
    }, delay * 1000);
    this.#host.changed();
  }

  /** Pauses playback, unless the pauses of this play are used up; cancels a start that waits for its delay. */
  pause(): void {
    if (this.#waiting) {
      this.#cancel();
      this.#host.changed();
      return;
    }
    if (!this.playing) return;
    if (!this.pausable) {
      this.#host.notify("no-pauses");
      return;
    }
    this.#pauses += 1;
    this.#media.pause();
    const duration = this.#rules.pauseDuration;
    if (duration === undefined) return;
    this.#host.notify("resumes");
    this.#timer = setTimeout(() => {
      this.#host.notify(undefined);
      this.#start();
    }, duration * 1000);
  }

  /** Takes the recording back to its start; the next play counts as a new one. */
  rewind(): void {
    this.#cancel();
    this.#media.pause();
    this.#media.currentTime = 0;
    this.#fresh = true;
    this.#host.changed();
  }

  /** Stops playback and every wait, as when the element leaves the page. */
  stop(): void {
    this.#cancel();
    this.#media.pause();
  }

  #start(): void {
    // The browser refuses a play that no gesture asked for; the candidate presses play instead.
    this.#media.play().catch(() => undefined);
  }

  #cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#waiting = false;
    this.#host.notify(undefined);
  }

  #onPlaying(): void {
    if (this.#fresh) {
      this.#fresh = false;
      this.#pauses = 0;
      this.#host.started();
    }
    this.#host.notify(undefined);
    this.#host.changed();
  }

  #onEnded(): void {
    this.#fresh = true;
    this.#host.changed();
    if (this.#rules.loop && !this.exhausted) this.#start();
  }
}
