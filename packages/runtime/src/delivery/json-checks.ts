import * as v from "valibot";
import { describe, isRecord, type Schema } from "../checks.js";

/** The depth of nesting that JSON content may have: the depth the XML reader allows (`DEFAULT_XML_LIMITS.maxDepth`). */
const MAX_JSON_DEPTH = 256;

/** Whether a value is an object that `JSON.parse` makes: a prototype of `Object` or none. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function firstProblem(values: readonly unknown[], depth: number): string | undefined {
  for (const entry of values) {
    const problem = plainProblem(entry, depth + 1);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/**
 * Returns what keeps JSON data from surviving `JSON.stringify` and `JSON.parse` as it is, or `undefined` when it does:
 * strings, finite numbers, booleans, arrays and plain objects, nested at most {@link MAX_JSON_DEPTH} levels. A property
 * that is `undefined` is absent in JSON, so it passes; `null` does not, because the content of a view has no NULL.
 */
function plainProblem(value: unknown, depth = 0): string | undefined {
  if (value === undefined || typeof value === "string" || typeof value === "boolean") return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? undefined : `holds ${String(value)}, which JSON cannot carry`;
  }
  if (depth >= MAX_JSON_DEPTH) return `nests deeper than ${MAX_JSON_DEPTH} levels`;
  if (Array.isArray(value)) return firstProblem(value, depth);
  if (isPlainObject(value)) {
    if (Object.hasOwn(value, "__proto__")) return 'holds an object with a property "__proto__"';
    return firstProblem(Object.values(value), depth);
  }
  return `must hold only strings, finite numbers, booleans, arrays and objects, found ${describe(value)}`;
}

/** The schema of JSON data that survives `JSON.stringify` and `JSON.parse` as it is. */
export const plainSchema: Schema<unknown> = v.pipe(
  v.unknown(),
  v.rawCheck(({ dataset, addIssue }) => {
    const problem = plainProblem(dataset.value);
    if (problem !== undefined) addIssue({ message: problem });
  }),
);

const nodeShape = v.looseObject({ kind: v.string() });

/**
 * The schema of one node of the content model, as a view carries it: plain JSON data with a string `kind`.
 *
 * @typeParam TNode - The type of the node. The content model is the writer's to keep, so only the `kind` is checked.
 */
export function nodeSchema<TNode>(): Schema<TNode> {
  return v.pipe(
    plainSchema,
    nodeShape,
    v.transform((node) => node as unknown as TNode),
  );
}

/**
 * The schema of content that a view carries: an array of nodes of the content model, as {@link nodeSchema} reads each.
 *
 * @typeParam TNode - The type of a node.
 */
export function nodesSchema<TNode>(): Schema<readonly TNode[]> {
  return v.pipe(
    plainSchema,
    v.array(nodeShape),
    v.transform((nodes) => nodes as unknown as readonly TNode[]),
  );
}
