import type { SessionCallOptions } from "../../protocol/index.js";
import type { ItemSettings } from "./settings.js";
import type { MountState } from "./state.js";

/**
 * Ties what a mount asks of the page to the life of the mount: its fetches and the calls to the host's files end when the mount
 * is destroyed, and an error that arrives after that is not reported, since nobody is left to read it.
 *
 * @param settings - The settings of the mount.
 * @param state - The state of the mount, whose `stop` ends the calls and whose `destroyed` silences the reports.
 * @returns The settings with the bound `fetch`, `files` and `report`.
 */
export function bindToLifetime<T extends ItemSettings>(settings: T, state: MountState): T {
  const { fetch, files, report } = settings;
  const { signal } = state.stop;
  const within = (options: SessionCallOptions | undefined): SessionCallOptions => ({
    signal: options?.signal ?? signal,
  });
  return {
    ...settings,
    fetch: (url, request) => fetch(url, { ...request, signal }),
    files: {
      upload: (bytes, mimeType, fileName, options) => files.upload(bytes, mimeType, fileName, within(options)),
      read: (file, options) => files.read(file, within(options)),
      url: (file) => files.url(file),
    },
    report: (error) => {
      if (!state.destroyed) report(error);
    },
  };
}
