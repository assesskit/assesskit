import type { AsiDocument } from "../asi/index.js";
import { walkDocument } from "../asi/internal.js";
import { BindRuleSets } from "./bind-rule-sets.js";
import { checkDocumentElement } from "./document-checks.js";
import type { Findings } from "./findings.js";
import { FormatChecks } from "./formats.js";

/**
 * Runs the checks that hold for the elements of every kind of document, without the declarations of an item: the rule sets
 * of the XML binding, the formats of the text attributes, and the checks of {@link checkDocumentElement}.
 *
 * @param document - The document of any kind.
 * @param findings - The findings of the document, which receive the issues.
 */
export function checkElements(document: AsiDocument, findings: Findings): void {
  const bind = new BindRuleSets(findings, undefined);
  const formats = new FormatChecks(findings);
  walkDocument(document, (visit) => {
    checkDocumentElement(visit, findings);
    bind.visit(visit);
    formats.visit(visit);
  });
  formats.finish();
}
