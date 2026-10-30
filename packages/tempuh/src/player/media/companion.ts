/** The most that a companion may differ from the recording it follows before it is set to the same time, in seconds. */
const DRIFT = 0.3;

/**
 * Returns the recording that an element is or holds: the one that the candidate plays and the rules of the item hold for.
 *
 * @param element - The element.
 * @param except - An element inside it whose recordings do not count, such as the card that a support added.
 */
export function recordingOf(element: Element, except: Element): HTMLMediaElement | undefined {
  if (element instanceof HTMLMediaElement) return element;
  return [...element.querySelectorAll<HTMLMediaElement>("audio, video")].find((media) => !except.contains(media));
}

/**
 * Makes a recording follow another: it plays, pauses, seeks and changes speed with it, never by itself. A sign language
 * video or an audio description of a recording is the same recording in another form, so it must keep the rules of the
 * recording it goes with: a candidate who has played it as often as `max-plays` allows cannot play it again through the
 * companion. The companion is muted and has no controls of its own while it follows, since the recording it goes with
 * carries the sound and the controls.
 *
 * @param primary - The recording that the player controls.
 * @param companion - The recording that goes with it.
 * @returns A function that lets the companion go and gives it back its controls and its sound.
 */
export function followPlayback(primary: HTMLMediaElement, companion: HTMLMediaElement): () => void {
  const controls = companion.hasAttribute("controls");
  const muted = companion.muted;
  companion.removeAttribute("controls");
  companion.muted = true;

  const align = (): void => {
    if (Math.abs(companion.currentTime - primary.currentTime) > DRIFT) companion.currentTime = primary.currentTime;
  };
  const follow = (): void => {
    companion.playbackRate = primary.playbackRate;
    align();
    if (primary.paused || primary.ended) {
      companion.pause();
    } else {
      // The browser may refuse a play that no gesture asked for; the primary was started by one.
      companion.play().catch(() => undefined);
    }
  };
  const events = ["play", "playing", "pause", "seeked", "ended", "ratechange"] as const;
  for (const event of events) primary.addEventListener(event, follow);
  primary.addEventListener("timeupdate", align);
  follow();
  return () => {
    for (const event of events) primary.removeEventListener(event, follow);
    primary.removeEventListener("timeupdate", align);
    companion.pause();
    companion.muted = muted;
    if (controls) companion.setAttribute("controls", "");
  };
}
