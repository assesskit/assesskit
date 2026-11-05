/**
 * The statuses of a candidate session and of an item session: a leaf of its own, because a view holds them and no file of the
 * engine is reachable from the wire forms.
 */

/** The statuses of a candidate session, for the checks. */
export const DELIVERY_STATUSES = ["in-progress", "suspended", "ended"] as const;

/**
 * Where a candidate session is: running, suspended or ended.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** The states of an item session, for the checks. */
export const ITEM_SESSION_STATUSES = ["initial", "interacting", "suspended", "closed", "review", "solution"] as const;

/**
 * The state of an item session in its lifecycle:
 *
 * | State         | The item …                                                                                         |
 * | ------------- | -------------------------------------------------------------------------------------------------- |
 * | `initial`     | will be delivered and has not been presented                                                       |
 * | `interacting` | is presented: the candidate responds in an attempt, or sees the feedback of the attempt that ended |
 * | `suspended`   | was presented and its candidate session ended, as when the candidate moved to another item         |
 * | `closed`      | allows no further attempt; its responses are fixed                                                 |
 * | `review`      | is presented again after it closed, with its responses fixed                                       |
 * | `solution`    | is presented after it closed, with the correct responses in place of the candidate's               |
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export type ItemSessionStatus = (typeof ITEM_SESSION_STATUSES)[number];
