import { DataError } from "../../errors.js";
import { AGS_SCOPE } from "../claims.js";
import { checkHttpRequest, errorBody, type HttpRequest, type HttpResponse, jsonResponse } from "../http.js";
import { readAccess } from "./access.js";
import { readAgsScore } from "./ags-score.js";
import { LINE_ITEM_PATH } from "./config.js";
import {
  type AgsScoresOptions,
  checkPlatformOptions,
  checkRequestOrigin,
  checkScoresOptions,
  type PlatformOptions,
} from "./options.js";
import { resourceLinkId } from "./resource-link.js";
import { type LineItem, openLineItem } from "./tokens.js";

const LINE_ITEM_TYPE = "application/vnd.ims.lis.v2.lineitem+json";
const SCORE_TYPE = "application/vnd.ims.lis.v1.score+json";
const SCORES_SUFFIX = "/scores";

/** A line item that a request names, with its URL. */
interface Found {
  readonly lineItem: LineItem;
  readonly url: string;
}

/**
 * Finds the line item that the path of a request names: `/ags/{line item}` followed by the suffix. Returns `undefined` when
 * the path is not that or the line item was not sealed by this platform.
 */
async function find(request: HttpRequest, options: PlatformOptions, suffix: string): Promise<Found | undefined> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(LINE_ITEM_PATH) || !pathname.endsWith(suffix)) return undefined;
  const id = pathname.slice(LINE_ITEM_PATH.length, pathname.length - suffix.length);
  const lineItem = await openLineItem(id, options.config.hintKey);
  return lineItem && { lineItem, url: `${options.config.origin}${LINE_ITEM_PATH}${id}` };
}

const notFound = (): HttpResponse => jsonResponse(404, { error: "not_found" });
const notAllowed = (method: string): HttpResponse =>
  jsonResponse(405, { error: "method_not_allowed" }, { allow: method });
const forbidden = (description: string): HttpResponse => jsonResponse(403, errorBody("forbidden", description));
const badRequest = (description: string): HttpResponse => jsonResponse(400, errorBody("bad_request", description));

/** Returns the media type of a request without its parameters, in lower case. */
function mediaType(request: HttpRequest): string | undefined {
  return request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
}

/**
 * Answers a request for the line item of an item instance (LTI AGS 2.0 §3.2.2.1): `GET {origin}/ags/{line item}`.
 *
 * The line item is the one that `ltiPlatformAuthorize` named in the launch. The request needs a token of the tool that the
 * line item is for, with the scope `lineitem.readonly` or `lineitem`. The answer has the media type
 * `application/vnd.ims.lis.v2.lineitem+json` and `id`, `label`, `scoreMaximum` and `resourceLinkId`. It is 401 for a missing
 * or unusable token, 403 for a missing scope or another tool's line item, 404 for a path that names no line item, and 405
 * for a method other than GET.
 *
 * @throws `AccessError` (`wrong-origin`) when the request is for another origin than the platform's.
 * @throws `DataError` when the request or the options have the wrong type.
 */
export async function agsLineItem(request: HttpRequest, options: PlatformOptions): Promise<HttpResponse> {
  checkHttpRequest(request);
  checkPlatformOptions(options);
  checkRequestOrigin(request, options.config);
  const found = await find(request, options, "");
  if (found === undefined) return notFound();
  if (request.method !== "GET") return notAllowed("GET");
  const access = await readAccess(request, options, [AGS_SCOPE.lineitemReadonly, AGS_SCOPE.lineitem]);
  if ("status" in access) return access;
  const { lineItem, url } = found;
  if (lineItem.client !== access.client) return forbidden("The line item is not the line item of this tool.");
  const body = {
    id: url,
    label: lineItem.title,
    scoreMaximum: lineItem.scoreMaximum,
    resourceLinkId: await resourceLinkId(lineItem.session, lineItem.item),
  };
  return jsonResponse(200, body, {}, LINE_ITEM_TYPE);
}

/**
 * Receives a score (LTI AGS 2.0 §3.4): `POST {origin}/ags/{line item}/scores` with the media type
 * `application/vnd.ims.lis.v1.score+json`.
 *
 * The request needs a token of the tool that the line item is for, with the scope `score`, and a score that
 * `readAgsScore` accepts and whose `userId` is the `sub` of the launch. A `scoreGiven` above `scoreMaximum` is accepted
 * (§3.4.4). The score goes to `options.onScore` with the session and the item instance, and the answer is 204. It is 401 for
 * a missing or unusable token, 403 for a missing scope, another tool's line item or another user, 404 for a path that
 * names no line item, 405 for a method other than POST, 415 for another media type and 400 for a body that is not a score.
 *
 * @throws `AccessError` (`wrong-origin`) when the request is for another origin than the platform's.
 * @throws `DataError` when the request or the options have the wrong type.
 */
export async function agsScores(request: HttpRequest, options: AgsScoresOptions): Promise<HttpResponse> {
  checkHttpRequest(request);
  checkScoresOptions(options);
  checkRequestOrigin(request, options.config);
  const found = await find(request, options, SCORES_SUFFIX);
  if (found === undefined) return notFound();
  if (request.method !== "POST") return notAllowed("POST");
  const access = await readAccess(request, options, [AGS_SCOPE.score]);
  if ("status" in access) return access;
  const { lineItem } = found;
  if (lineItem.client !== access.client) return forbidden("The line item is not the line item of this tool.");
  if (mediaType(request) !== SCORE_TYPE) {
    return jsonResponse(415, { error: "unsupported_media_type" }, { accept: SCORE_TYPE });
  }
  let body: unknown;
  try {
    body = JSON.parse(request.body);
  } catch {
    return badRequest("The body of a score must be JSON.");
  }
  let score: ReturnType<typeof readAgsScore>;
  try {
    score = readAgsScore(body);
  } catch (error) {
    if (error instanceof DataError) return badRequest(error.message);
    throw error;
  }
  if (score.userId !== lineItem.subject) return forbidden("The score is not for the user of the launch.");
  await options.onScore(lineItem.session, lineItem.item, score);
  return { status: 204, headers: {}, body: "" };
}
