// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the entries quote source code, which holds template strings.
import type { Rule } from "./rule.ts";

const HANDLER = "packages/player/src/cat-rest/rest-handler.ts";
const AUTHORIZATION = "packages/player/src/cat-rest/authorization.ts";
const BODY = "packages/player/src/cat-rest/body.ts";
const STATUS = "packages/player/src/cat-rest/status.ts";
const PORT = "packages/player/src/cat-rest/rest-port.ts";
const CLIENT = "packages/player/src/cat-rest/rest-client.ts";
const METADATA = "packages/player/src/cat-rest/metadata-record.ts";
const TEST = "packages/player/test/cat-rest.test.ts";

/** The security rules of the two sides of the CAT REST binding, each with the test that guards it. */
export const CAT_REST_RULES: readonly Rule[] = [
  {
    rule: "A body of a request with a name that reaches the prototype, at any depth, answers 400.",
    file: BODY,
    find: 'checkJsonInput(json, "The body of the request");',
    replace: "",
    test: TEST,
  },
  {
    rule: "An answer of an engine with a name that reaches the prototype, at any depth, is refused.",
    file: CLIENT,
    find: "checkJsonInput(json, `${what} answered with JSON that`);",
    replace: "",
    test: TEST,
  },
  {
    rule: "A QTI metadata record of a request is refused as a list, at both of its levels.",
    file: METADATA,
    find: "strictRecord(metadataEntries(strictRecord(pciContextEntries))),",
    replace: "v.strictObject(metadataEntries(v.strictObject(pciContextEntries))),",
    test: TEST,
  },
  {
    rule: "The context of a portable custom interaction of an answer is refused as a list.",
    file: METADATA,
    find: "v.object(metadataEntries(v.pipe(recordSchema, v.object(pciContextEntries)))),",
    replace: "v.object(metadataEntries(v.object(pciContextEntries))),",
    test: TEST,
  },
  {
    rule: "The body of a request is not read before the authorization step has decided.",
    file: HANDLER,
    find: "granted = grantOf(await authorize(request, operation), operation);",
    replace:
      "await request.body?.getReader().read();\n      granted = grantOf(await authorize(request, operation), operation);",
    test: TEST,
  },
  {
    rule: "Only `true` and the port of the caller serve a request; every other decision refuses or fails it.",
    file: AUTHORIZATION,
    find: "if (decision === true) return { serve: true, port: undefined };",
    replace: "if (decision !== false) return { serve: true, port: undefined };",
    test: TEST,
  },
  {
    rule: "A result of the authorization step that is not a decision answers 500.",
    file: AUTHORIZATION,
    find: 'const decision = parseWith(decisionSchema, result, "The result of authorize");',
    replace: "const decision = result as never;",
    test: TEST,
  },
  {
    rule: "A token that lacks the scope of the operation answers 403, and not 401.",
    file: AUTHORIZATION,
    find: 'response: failureResponse(403, "The token does not carry the scope of this operation.", {',
    replace: 'response: failureResponse(401, "The token does not carry the scope of this operation.", {',
    test: TEST,
  },
  {
    rule: "A request that is aborted during the authorization step does not go on to the port.",
    file: HANDLER,
    find: "signal.throwIfAborted();\n    if (!granted.serve) return granted.response;",
    replace: "if (!granted.serve) return granted.response;",
    test: TEST,
  },
  {
    rule: "A body is counted as the stream is read, and a body above maxBodyBytes is refused.",
    file: BODY,
    find: "if (length > maxBytes) {",
    replace: "if (false) {",
    test: TEST,
  },
  {
    rule: "A body whose JSON has more tokens than maxTokens is refused before it is parsed.",
    file: BODY,
    find: "if (hasMoreTokensThan(text, maxTokens)) {",
    replace: "if (false) {",
    test: TEST,
  },
  {
    rule: "A declared length above maxBodyBytes is refused before the body is read.",
    file: BODY,
    find: 'if (Number(request.headers.get("content-length")) > maxBytes) throw tooLarge;',
    replace: "",
    test: TEST,
  },
  {
    rule: "The read of a body ends with the signal: the stream is cancelled when the request is aborted.",
    file: BODY,
    find: "const stop = (): void => void reader?.cancel(signal.reason).catch(() => undefined);",
    replace: "const stop = (): void => undefined;",
    test: TEST,
  },
  {
    rule: "The message of a port's `ServiceError` is never shown to the caller.",
    file: STATUS,
    find: 'if (error.status === 400) return { status: 400, description: "The engine refused the request.", fault: false };',
    replace: "if (error.status === 400) return { status: 400, description: error.message, fault: false };",
    test: TEST,
  },
  {
    rule: "The message of any other error of the port is never shown, whatever its class.",
    file: STATUS,
    find: "  return { status: 500, description: FAULT, fault: true };\n}\n\n/** The failure of an answer that the port gave",
    replace:
      "  return { status: 500, description: String(error), fault: true };\n}\n\n/** The failure of an answer that the port gave",
    test: TEST,
  },
  {
    rule: "A failed request for a token answers 500 and reaches onError, whatever the status of the token endpoint, and never blames the caller.",
    file: STATUS,
    find: "if (error instanceof ServiceError && !(error instanceof TokenEndpointError)) {",
    replace: "if (error instanceof ServiceError) {",
    test: TEST,
  },
  {
    rule: "Every answer of 500 reports its error to onError.",
    file: HANDLER,
    find: "if (failure.fault) report(cause, request, operation);",
    replace: "",
    test: TEST,
  },
  {
    rule: "Every answer carries `Cache-Control: no-store`, because the bodies hold a candidate's data.",
    file: STATUS,
    find: 'const BASE_HEADERS = { "Cache-Control": "no-store" } as const;',
    replace: "const BASE_HEADERS = {} as const;",
    test: TEST,
  },
  {
    rule: "The port receives the prefix that the host set, not the address of the request.",
    file: HANDLER,
    find: "reference ?? `${url.origin}${root}`,",
    replace: "`${url.origin}${root}`,",
    test: TEST,
  },
  {
    rule: "A reference that the host did not configure sends nothing: no candidate data and no token.",
    file: PORT,
    find: "if (found === undefined) {",
    replace: "if (found === undefined && false) {",
    test: TEST,
  },
  {
    rule: "An answer of an engine or of its token endpoint whose JSON has more tokens than maxTokens is refused before it is parsed.",
    file: CLIENT,
    find: "if (hasMoreTokensThan(text, maxTokens)) {",
    replace: "if (false) {",
    test: TEST,
  },
  {
    rule: "Engines with their own credentials never share a token.",
    file: CLIENT,
    find: "JSON.stringify([credentials.tokenUrl, credentials.clientId, credentials.scope]);",
    replace: '"";',
    test: TEST,
  },
  {
    rule: "The personal needs and preferences go only to an engine that is set to receive them.",
    file: PORT,
    find: "const body = writeCreateSessionBody(request, engine.sharePnp ?? false);",
    replace: "const body = writeCreateSessionBody(request, true);",
    test: TEST,
  },
  {
    rule: "A redirect of the token endpoint or of an engine is refused, so that the token goes to no other address.",
    file: CLIENT,
    find: 'if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {',
    replace: "if (false) {",
    test: TEST,
  },
];
