import type { CallOptions } from "@assesskit/runtime/checks";
import type { ItemSettings } from "./settings.js";
import type { MountState } from "./state.js";

/**
 * Ties what a mount asks of the page to the life of the mount: its fetches and the calls to the host's files end when the mount
 * is destroyed, except `fill`, which stores the bytes of a recording that the end of the mount stopped; and an error that
 * arrives after that is not reported, since nobody is left to read it.
 *
 * @param settings - The settings of the mount.
 * @param state - The state of the mount, whose `stop` ends the calls and whose `destroyed` silences the reports.
 * @returns The settings with the bound `fetch`, `files` and `report`.
 */
export function bindToLifetime<T extends ItemSettings>(settings: T, state: MountState): T {
  const { fetch, files, report } = settings;
  const { reserve, fill } = files;
  const { signal } = state.stop;
  const within = (options: (CallOptions & { readonly fileName?: string }) | undefined) => ({
    ...options,
    signal: options?.signal ?? signal,
  });
  return {
    ...settings,
    fetch: (url, request) => fetch(url, { ...request, signal }),
    files: {
      upload: (bytes, mimeType, options) => files.upload(bytes, mimeType, within(options)),
      read: (file, options) => files.read(file, within(options)),
      url: (file) => files.url(file),
      ...(reserve === undefined
        ? {}
        : { reserve: (mimeType, options) => reserve.call(files, mimeType, within(options)) }),
      // The bytes of a recording that the end of the mount stops still arrive: only the caller's signal ends `fill`.
      ...(fill === undefined ? {} : { fill: (file, bytes, options) => fill.call(files, file, bytes, options) }),
    },
    report: (error) => {
      if (!state.destroyed) report(error);
    },
  };
}
