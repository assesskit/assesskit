/**
 * Why the engine refuses an action that is well formed but that the rules do not allow (E4):
 *
 * | Code                   | The action …                                                                                     |
 * | ---------------------- | ------------------------------------------------------------------------------------------------ |
 * | `attempts-exhausted`   | starts an attempt at an item whose session allows no further attempt (INFO §7.19.1, §2.2.2.3)     |
 * | `clock-regression`     | is stamped before the latest change of the session (G27)                                         |
 * | `comment-not-allowed`  | comments on an item whose item session control does not allow comments (INFO §7.19.5)            |
 * | `invalid-response`     | sets a variable that is not a response the candidate gives, or a value of another type; names no end attempt interaction or PCI of the item; or submits responses that `validate-responses` rejects (INFO §7.19.7) |
 * | `item-closed`          | changes or submits the responses of a session that is closed (INFO §2.2.1)                      |
 * | `not-current`          | acts on an item that has not been presented (INFO §2.2.1)                                        |
 * | `review-not-allowed`   | reviews an item whose session is open or whose control does not allow review (INFO §7.19.3)      |
 * | `skipping-not-allowed` | submits no response to an item that does not allow skipping (INFO §7.19.6)                       |
 * | `solution-not-allowed` | asks for the solution of an item whose session is open or that shows no solution (INFO §7.19.4)  |
 * | `suspended`            | acts on an item whose session is suspended (INFO §2.2.1)                                         |
 * | `unknown-item`         | names another item instance than the session's                                                   |
 * | `value-out-of-range`   | sets an integer outside the safe integers (D3)                                                   |
 */
export type RefusalCode =
  | "attempts-exhausted"
  | "clock-regression"
  | "comment-not-allowed"
  | "invalid-response"
  | "item-closed"
  | "not-current"
  | "review-not-allowed"
  | "skipping-not-allowed"
  | "solution-not-allowed"
  | "suspended"
  | "unknown-item"
  | "value-out-of-range";

/** The engine's answer to a well-formed action that the rules do not allow; the state stays as it was (E4). */
export interface Refusal {
  /** Why the action is refused. */
  readonly code: RefusalCode;
  /** A sentence that says what the rule demands. */
  readonly message: string;
  /** The section of the specification that states the rule, such as `INFO §7.19.6`. */
  readonly source: string;
}

/** Returns a refused step. */
export function refuse(
  code: RefusalCode,
  message: string,
  source: string,
): { readonly ok: false; readonly refusal: Refusal } {
  return { ok: false, refusal: { code, message, source } };
}
