import type { DeliveryStatus } from "./delivery-state.js";
import type { ItemSessionStatus } from "./item-session.js";

/** The statuses of a candidate session, for the checks. */
export const DELIVERY_STATUSES: readonly DeliveryStatus[] = ["in-progress", "suspended", "ended"];

/** The states of an item session, for the checks. */
export const ITEM_SESSION_STATUSES: readonly ItemSessionStatus[] = [
  "initial",
  "interacting",
  "suspended",
  "closed",
  "review",
  "solution",
];
