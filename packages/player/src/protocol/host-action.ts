import { checkChoice, checkRecord } from "@assesskit/runtime/checks";
import type { HostAction } from "@assesskit/runtime/delivery";

/** The types of the actions of the host, which a candidate never sends. */
const HOST_ACTION_TYPES = ["time", "supply-scores", "cat-response"] as const satisfies readonly HostAction["type"][];

/**
 * Checks that a value is an action of the host by its type. The engine checks the rest of the action when it stamps it.
 *
 * @throws `DataError` when it is not an object, or its type is not `time`, `supply-scores` or `cat-response`.
 */
export function checkHostAction(action: unknown): void {
  checkRecord(action, "The action must be an object with a type");
  checkChoice(action.type, "The type of a host action", HOST_ACTION_TYPES);
}
