import { createItemSession, parseQtiXml, type QtiDiagnostic, type QtiDocument } from "@longsightgroup/qti3-core";
import type { Implementation, ItemCase, Observed } from "./model.ts";

/** Parses an item with the oracle, or returns why it does not accept it. */
function parse(xml: string): QtiDocument | string {
  const parsed = parseQtiXml(xml);
  const errors = parsed.diagnostics.filter((diagnostic: QtiDiagnostic) => diagnostic.severity === "error");
  if (!parsed.ok || !parsed.document)
    return errors.map((diagnostic) => diagnostic.message).join("; ") || "The item does not parse.";
  return parsed.document;
}

/**
 * Returns the correct responses of an item by response identifier, as the oracle reads them from the item's response
 * declarations.
 *
 * @returns `undefined` when the oracle does not accept the item.
 */
export function correctResponses(xml: string, seed: number): Record<string, Observed> | undefined {
  const document = parse(xml);
  return typeof document === "string"
    ? undefined
    : createItemSession(document, undefined, { randomSeed: seed }).correctResponses();
}

/** Longsight `qti3-core`: the oracle that olah's item processing is compared with. */
export const longsight: Implementation = {
  name: "Longsight qti3-core",
  run: ({ xml, responses, seed }: ItemCase) => {
    const document = parse(xml);
    if (typeof document === "string") return { accepted: false, reason: document };
    const session = createItemSession(document, undefined, { randomSeed: seed });
    for (const [identifier, value] of Object.entries(responses)) session.respond(identifier, value);
    const { outcomes, state } = session.score();
    return { accepted: true, observation: { outcomes, templateValues: state.templateValues ?? {} } };
  },
};
