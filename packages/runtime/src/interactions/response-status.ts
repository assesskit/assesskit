/**
 * How far a candidate has got with an item or an interaction: `presented` when the candidate gave no response,
 * `attempted` when the response is invalid, and `answered` when it is valid.
 *
 * @remarks
 * These are terms of `AnsweredStatus` of `results`; the fourth, `notpresented`, is for an item that was never shown,
 * which no response check can tell.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
export type ResponseStatus = "answered" | "attempted" | "presented";
