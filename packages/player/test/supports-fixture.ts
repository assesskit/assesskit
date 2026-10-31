import type { SupportView } from "@assesskit/runtime/delivery";
import type { SupportName, SupportSetting, SupportState } from "@assesskit/runtime/pnp";

/** What a test says of a support: the state and whether it is on, with the settings of the profile when it has some. */
export interface SupportFields {
  /** Default: `assigned`. */
  readonly state?: SupportState;
  /** Default: `false`. */
  readonly active?: boolean;
  /** The settings, whose `name` is the support's. Default: none. */
  readonly settings?: SupportSetting;
}

/** Builds a support as the runtime's view has it. */
export function supportView(
  name: SupportName,
  { state = "assigned", active = false, settings }: SupportFields = {},
): SupportView {
  return { name, state, active, ...(settings === undefined ? {} : { settings }) };
}

/** A support that is on, as the engine gives one that the profile activates at initialization. */
export function onSupport(name: SupportName, settings?: SupportSetting): SupportView {
  return supportView(name, { state: "active", active: true, ...(settings === undefined ? {} : { settings }) });
}
