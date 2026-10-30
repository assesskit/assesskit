import type { webcrypto } from "node:crypto";
import type { ItemKey } from "@luthfanwakan/olah/delivery";
import { AccessError, LtiError } from "../../errors.js";
import {
  type Claims,
  IDENTIFIER,
  NUMBER,
  POSITIVE_INTEGER,
  POSITIVE_NUMBER,
  RECORD,
  required,
  STRING,
  STRING_ARRAY,
  STRING_RECORD,
} from "../claims.js";
import { openToken, sealToken } from "./seal.js";

const OWNER = "The sealed token";

/** What `lti_message_hint` carries: the launch that the platform prepared for one candidate and one item (D-M1). */
export interface Hint {
  /** The session of the candidate. */
  readonly session: string;
  /** The item instance that the tool is launched for. */
  readonly item: ItemKey;
  /** The authenticated principal; the `sub` of the launch. */
  readonly principal: string;
  /** The client identifier of the tool that the hint is for. */
  readonly client: string;
  /** The tool's `target_link_uri`. */
  readonly target: string;
  /** The custom properties of the link, by name. */
  readonly custom: Readonly<Record<string, string>>;
  /** The title of the link, which labels the line item. */
  readonly title: string;
  /** The highest score of the item, which is the `scoreMaximum` of the line item. */
  readonly scoreMaximum: number;
  /** The identifier that makes the hint single-use. */
  readonly jti: string;
  /** The time in seconds since 1970-01-01T00:00:00Z at which the hint expires. */
  readonly exp: number;
}

/** What the identifier of a line item carries: the one line item of an item instance of a session (LTI AGS 2.0 §3.1). */
export interface LineItem {
  /** The session of the candidate. */
  readonly session: string;
  /** The item instance. */
  readonly item: ItemKey;
  /** The client identifier of the tool that may use the line item. */
  readonly client: string;
  /** The `sub` of the launch: the only user a score may be for. */
  readonly subject: string;
  /** The label of the line item. */
  readonly title: string;
  /** The `scoreMaximum` of the line item. */
  readonly scoreMaximum: number;
}

/** What an access token carries: the tool it was issued to, its scopes and its expiry. */
export interface Access {
  /** The client identifier of the tool. */
  readonly client: string;
  /** The granted scopes. */
  readonly scopes: readonly string[];
  /** The time in seconds since 1970-01-01T00:00:00Z at which the token expires. */
  readonly exp: number;
}

function readItem(source: Claims): ItemKey {
  const item = required(source, "item", OWNER, RECORD);
  return { ref: required(item, "ref", OWNER, STRING), instance: required(item, "instance", OWNER, POSITIVE_INTEGER) };
}

/** Seals the hint of a launch. */
export function sealHint(hint: Hint, key: webcrypto.CryptoKey): Promise<string> {
  return sealToken("hint", { ...hint }, key);
}

/**
 * Opens a hint.
 *
 * @throws `AccessError` (`hint-invalid`) when the token is not a hint that this platform sealed.
 */
export async function openHint(token: string, key: webcrypto.CryptoKey): Promise<Hint> {
  const claims = await openToken(token, "hint", key);
  try {
    if (claims === undefined) throw new LtiError("The token is not sealed by this platform.", "hint-invalid");
    return {
      session: required(claims, "session", OWNER, STRING),
      item: readItem(claims),
      principal: required(claims, "principal", OWNER, IDENTIFIER),
      client: required(claims, "client", OWNER, STRING),
      target: required(claims, "target", OWNER, STRING),
      custom: required(claims, "custom", OWNER, STRING_RECORD),
      title: required(claims, "title", OWNER, STRING),
      scoreMaximum: required(claims, "scoreMaximum", OWNER, POSITIVE_NUMBER),
      jti: required(claims, "jti", OWNER, STRING),
      exp: required(claims, "exp", OWNER, NUMBER),
    };
  } catch (error) {
    if (error instanceof LtiError) {
      throw new AccessError("The lti_message_hint is not a hint that this platform issued.", "hint-invalid");
    }
    throw error;
  }
}

/** Seals the `login_hint`: the principal, signed with the same key as the message hint. */
export function sealLoginHint(principal: string, key: webcrypto.CryptoKey): Promise<string> {
  return sealToken("login", { principal }, key);
}

/** Opens a `login_hint` and returns the principal, or `undefined` when the token is not one of this platform. */
export async function openLoginHint(token: string, key: webcrypto.CryptoKey): Promise<string | undefined> {
  const claims = await openToken(token, "login", key);
  return typeof claims?.principal === "string" ? claims.principal : undefined;
}

/** Seals the identifier of a line item. */
export function sealLineItem(lineItem: LineItem, key: webcrypto.CryptoKey): Promise<string> {
  return sealToken("line-item", { ...lineItem }, key);
}

/** Opens the identifier of a line item, or returns `undefined` when it is not one of this platform. */
export async function openLineItem(token: string, key: webcrypto.CryptoKey): Promise<LineItem | undefined> {
  const claims = await openToken(token, "line-item", key);
  if (claims === undefined) return undefined;
  try {
    return {
      session: required(claims, "session", OWNER, STRING),
      item: readItem(claims),
      client: required(claims, "client", OWNER, STRING),
      subject: required(claims, "subject", OWNER, IDENTIFIER),
      title: required(claims, "title", OWNER, STRING),
      scoreMaximum: required(claims, "scoreMaximum", OWNER, POSITIVE_NUMBER),
    };
  } catch (error) {
    if (error instanceof LtiError) return undefined;
    throw error;
  }
}

/** Seals an access token. */
export function sealAccess(access: Access, key: webcrypto.CryptoKey): Promise<string> {
  return sealToken("access", { ...access }, key);
}

/** Opens an access token, or returns `undefined` when it is not one of this platform. */
export async function openAccess(token: string, key: webcrypto.CryptoKey): Promise<Access | undefined> {
  const claims = await openToken(token, "access", key);
  if (claims === undefined) return undefined;
  try {
    const scopes = required(claims, "scopes", OWNER, STRING_ARRAY);
    return { client: required(claims, "client", OWNER, STRING), scopes, exp: required(claims, "exp", OWNER, NUMBER) };
  } catch (error) {
    if (error instanceof LtiError) return undefined;
    throw error;
  }
}
