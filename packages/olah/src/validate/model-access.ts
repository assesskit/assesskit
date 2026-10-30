import type { ElementVisit } from "../asi/index.js";
import { isRecord } from "../checks.js";
import type { XmlAttribute } from "../xml/index.js";

type Properties = Readonly<Record<string, unknown>>;

/** Returns the element path of a visited element: the names of its ancestors and its own, such as `qti-assessment-item/qti-item-body`. */
export function elementPath(visit: ElementVisit): string {
  const names = [visit.name];
  for (let at = visit.parent; at !== undefined; at = at.parent) names.unshift(at.name);
  return names.join("/");
}

/** Returns a property of a model when it is a number, else `undefined`: a reference to a variable is a string. */
export function numberOf(model: Properties, key: string): number | undefined {
  const value = model[key];
  return typeof value === "number" ? value : undefined;
}

/** Returns a property of a model when it is a string, else `undefined`. */
export function textOf(model: Properties, key: string): string | undefined {
  const value = model[key];
  return typeof value === "string" ? value : undefined;
}

/** Returns the `kind` of each member of a property that holds an array of nodes. */
export function kindsOf(model: Properties, key: string): readonly string[] {
  const value = model[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((member: unknown) => (isRecord(member) && typeof member.kind === "string" ? [member.kind] : []));
}

/** Returns the extension attributes of a model, the attributes beyond the schema's. */
export function extensionsOf(model: Properties): readonly XmlAttribute[] {
  const value = model.extensions;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (member: unknown): member is XmlAttribute =>
      isRecord(member) && typeof member.name === "string" && typeof member.namespace === "string",
  );
}
