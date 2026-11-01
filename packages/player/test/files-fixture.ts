import type { MountFiles } from "../src/player/index.js";

/** The two methods that a mount needs to record, for the tests that record nothing: they fail when called. */
export const NO_RECORDING: Required<Pick<MountFiles, "reserve" | "fill">> = {
  reserve: () => Promise.reject(new Error("The test records nothing.")),
  fill: () => Promise.reject(new Error("The test records nothing.")),
};
