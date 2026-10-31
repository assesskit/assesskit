/**
 * The kinds of text track that show what is said as text.
 *
 * @see {@link https://html.spec.whatwg.org/multipage/media.html#attr-track-kind | HTML Standard, the kind of a track}
 */
export const CAPTION_KINDS: readonly string[] = ["captions", "subtitles"];

/**
 * The kind of text track that describes what is shown.
 *
 * @see {@link https://html.spec.whatwg.org/multipage/media.html#attr-track-kind | HTML Standard, the kind of a track}
 */
export const DESCRIPTION_KINDS: readonly string[] = ["descriptions"];

/**
 * Returns the text tracks of a recording of the given kinds.
 *
 * @param media - The recording.
 * @param kinds - The kinds of track.
 * @returns The tracks.
 */
export function tracksOf(media: HTMLMediaElement, kinds: readonly string[]): TextTrack[] {
  return [...media.textTracks].filter((track) => kinds.includes(track.kind));
}

/**
 * Returns whether any of the tracks is showing.
 *
 * @param tracks - The tracks.
 * @returns `true` when one has the mode `showing`.
 */
export function isShowing(tracks: readonly TextTrack[]): boolean {
  return tracks.some((track) => track.mode === "showing");
}

/**
 * Shows the text tracks of the given kinds of every recording in a root, and leaves the others as they are.
 *
 * @remarks
 * A candidate's supports use it for captions and audio description; the buttons of a media interaction follow the mode
 * of the tracks.
 *
 * @param root - The root that holds the recordings.
 * @param kinds - The kinds of track to show.
 * @returns A function that gives each track the mode it had.
 */
export function showTracks(root: ParentNode, kinds: readonly string[]): () => void {
  const changed: (readonly [TextTrack, TextTrackMode])[] = [];
  for (const media of root.querySelectorAll<HTMLMediaElement>("audio, video")) {
    for (const track of tracksOf(media, kinds)) {
      if (track.mode === "showing") continue;
      changed.push([track, track.mode]);
      track.mode = "showing";
    }
  }
  return () => {
    for (const [track, mode] of changed) track.mode = mode;
  };
}
