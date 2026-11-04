import {
  type BodyNode,
  type Catalog,
  isModelNode,
  type ModelNode,
  type PortableCustomInteraction,
} from "../asi/index.js";
import { isBodyNode, withDescendants } from "../asi/internal.js";

const isCatalog = (node: ModelNode): node is Catalog => node.kind === "catalog";
const isPortable = (node: ModelNode): node is PortableCustomInteraction => node.kind === "portable-custom-interaction";

/** Returns the catalogs in some content, including those of the `qti-catalog-info` of its feedback. */
export function catalogsIn(nodes: readonly ModelNode[]): Catalog[] {
  return withDescendants(nodes).filter(isCatalog);
}

/** Returns the portable custom interactions in some content. */
export function portableInteractionsIn(nodes: readonly ModelNode[]): PortableCustomInteraction[] {
  return withDescendants(nodes).filter(isPortable);
}

/** Returns the position of each identifier in its list of an order. */
function ranks(orders: readonly (readonly string[])[]): ReadonlyMap<string, number> {
  return new Map(orders.flatMap((order) => order.map((identifier, place): [string, number] => [identifier, place])));
}

/** Returns the identifier of a node that has one. */
const identifierOf = (node: unknown): string | undefined =>
  isModelNode(node) && "identifier" in node && typeof node.identifier === "string" ? node.identifier : undefined;

/** Whether a list holds nodes only, each with an identifier that the order names. */
function isOrdered(members: readonly unknown[], rank: ReadonlyMap<string, number>): boolean {
  return (
    members.length > 1 &&
    members.every((member) => {
      const identifier = identifierOf(member);
      return identifier !== undefined && rank.has(identifier);
    })
  );
}

/** Returns a node with the lists of choices below it in the order given, and the rest as it was. */
function arranged(node: ModelNode, rank: ReadonlyMap<string, number>): ModelNode {
  if (node.kind === "element") return node;
  const copy: { [property: string]: unknown; kind: string } = { ...node };
  for (const [property, content] of Object.entries(node)) {
    if (Array.isArray(content)) {
      const members = content.map((entry) => (isModelNode(entry) ? arranged(entry, rank) : entry));
      copy[property] = isOrdered(members, rank)
        ? members.toSorted(
            (first, second) => (rank.get(identifierOf(first) ?? "") ?? 0) - (rank.get(identifierOf(second) ?? "") ?? 0),
          )
        : members;
    } else if (isModelNode(content)) {
      copy[property] = arranged(content, rank);
    }
  }
  return copy;
}

/** Returns the response identifier of an interaction, `undefined` for any other node. */
const responseIdentifierOf = (node: ModelNode): string | undefined =>
  node.kind.endsWith("-interaction") && "responseIdentifier" in node && typeof node.responseIdentifier === "string"
    ? node.responseIdentifier
    : undefined;

/**
 * Returns the content with the choices of each interaction in the order of presentation: every list of choices, of
 * associable choices, of gap choices and the like inside an interaction takes the order that the session drew for the
 * interaction's response identifier.
 *
 * @remarks
 * Lists that mix choices with text, such as the gaps of a gap match interaction or the hot texts of a text, keep the
 * order of the document.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function arrangeChoices(
  nodes: readonly BodyNode[],
  orders: ReadonlyMap<string, readonly (readonly string[])[]>,
): readonly BodyNode[] {
  const visit = (node: ModelNode): ModelNode => {
    const responseIdentifier = responseIdentifierOf(node);
    if (responseIdentifier !== undefined) {
      const order = orders.get(responseIdentifier);
      return order === undefined ? node : arranged(node, ranks(order));
    }
    if (node.kind === "element") return node;
    const copy: { [property: string]: unknown; kind: string } = { ...node };
    for (const [property, content] of Object.entries(node)) {
      if (Array.isArray(content)) copy[property] = content.map((entry) => (isModelNode(entry) ? visit(entry) : entry));
      else if (isModelNode(content)) copy[property] = visit(content);
    }
    return copy;
  };
  return nodes.flatMap((node) => {
    const visited = visit(node);
    return isBodyNode(visited) ? [visited] : [];
  });
}
