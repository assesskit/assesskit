import type { CandidateView, ItemKey } from "@assesskit/runtime/delivery";

/** What the mounted player keeps between the views it shows. */
export interface MountState {
  /** The view that is shown. */
  view: CandidateView;
  /** Whether `destroy` has run. */
  destroyed: boolean;
  /** Aborts the fetches and the calls to the host's files of the mount when it is destroyed. */
  readonly stop: AbortController;
  /** What is drawn, as texts that compare: the item, the body of the view and its modal feedback. */
  readonly shown: { item: string; content: string; modal: string };
}

/**
 * Creates the state of a player that has drawn nothing.
 *
 * @param view - The view the player starts with.
 * @returns The state.
 */
export function createMountState(view: CandidateView): MountState {
  return { view, destroyed: false, stop: new AbortController(), shown: { item: "", content: "", modal: "" } };
}

/** Writes a value so that two of them compare as text: maps as lists of their entries. */
export const signature = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) => (member instanceof Map ? [...member] : member));

/** Names an item instance as text, and nothing as the empty text. */
export const itemId = (key: ItemKey | undefined): string => (key === undefined ? "" : `${key.ref} ${key.instance}`);
