import * as v from "valibot";
import { plainSchema, type Schema } from "../checks.js";

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
