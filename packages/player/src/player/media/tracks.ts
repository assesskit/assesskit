/** The kinds of text track that show what is said as text (HTML Standard §4.8.11.12.1). */
export const CAPTION_KINDS: readonly string[] = ["captions", "subtitles"];

/** The kind of text track that describes what is shown (HTML Standard §4.8.11.12.1). */
export const DESCRIPTION_KINDS: readonly string[] = ["descriptions"];

/** Returns the text tracks of the recording of the given kinds. */
export function tracksOf(media: HTMLMediaElement, kinds: readonly string[]): TextTrack[] {
  return [...media.textTracks].filter((track) => kinds.includes(track.kind));
}

/** Whether any of the tracks is showing. */
export function isShowing(tracks: readonly TextTrack[]): boolean {
  return tracks.some((track) => track.mode === "showing");
}

/**
 * Shows the text tracks of the given kinds of every recording in a root, and leaves the others as they are. A candidate's
 * supports use it for captions and audio description; the buttons of a media interaction follow the mode of the tracks.
 *
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
