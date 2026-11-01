import type { CatPort } from "@assesskit/runtime/cat";

/** The six requests of the binding, named as the methods of the runtime's `CatPort`. */
export type CatOperation = keyof CatPort;

/** The identifiers that a path carries; a request about a section has the first, a request about a session both. */
export interface PathIdentifiers {
  readonly sectionIdentifier: string;
  readonly sessionIdentifier: string;
}

/** What a request line selects. */
export type Route =
  | { readonly kind: "operation"; readonly operation: CatOperation; readonly identifiers: PathIdentifiers }
  /** The path is an endpoint, and the method is not one of its methods. */
  | { readonly kind: "method"; readonly allow: readonly string[] }
  /** The path is no endpoint. */
  | { readonly kind: "none" }
  /** A segment of the path is not valid percent-encoding. */
  | { readonly kind: "malformed" };

/** An endpoint of Table 2.1 of the binding: its path as segments, where `*` stands for an identifier, and its methods. */
interface Endpoint {
  readonly segments: readonly string[];
  readonly methods: ReadonlyMap<string, CatOperation>;
}

const ENDPOINTS: readonly Endpoint[] = [
  { segments: ["sections"], methods: new Map([["POST", "createSection"]]) },
  {
    segments: ["sections", "*"],
    methods: new Map([
      ["GET", "getSection"],
      ["DELETE", "endSection"],
    ]),
  },
  { segments: ["sections", "*", "sessions"], methods: new Map([["POST", "createSession"]]) },
  { segments: ["sections", "*", "sessions", "*"], methods: new Map([["DELETE", "endSession"]]) },
  { segments: ["sections", "*", "sessions", "*", "results"], methods: new Map([["POST", "submitResults"]]) },
];

/** The identifier of a segment, or `undefined` when it is not valid percent-encoding. */
function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * Selects the operation of a request.
 *
 * @param pathname - The path of the URL, percent-encoded.
 * @param method - The HTTP method.
 * @param root - The path under which the endpoints are served, without a trailing slash.
 * @returns The operation with the identifiers of the path, or why the request selects none.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding, table 2.1}
 */
export function matchRoute(pathname: string, method: string, root: string): Route {
  if (!pathname.startsWith(`${root}/`)) return { kind: "none" };
  const segments = pathname.slice(root.length + 1).split("/");
  const endpoint = ENDPOINTS.find(
    ({ segments: pattern }) =>
      pattern.length === segments.length &&
      pattern.every((part, index) => (part === "*" ? segments[index] !== "" : part === segments[index])),
  );
  if (endpoint === undefined) return { kind: "none" };
  const identifiers = endpoint.segments.flatMap((part, index) => (part === "*" ? [segments[index] ?? ""] : []));
  const decoded = identifiers.map(decode);
  const [sectionIdentifier, sessionIdentifier] = decoded;
  if (decoded.includes(undefined)) return { kind: "malformed" };
  const operation = endpoint.methods.get(method);
  if (operation === undefined) return { kind: "method", allow: [...endpoint.methods.keys()] };
  return {
    kind: "operation",
    operation,
    identifiers: { sectionIdentifier: sectionIdentifier ?? "", sessionIdentifier: sessionIdentifier ?? "" },
  };
}
