import { type AsiDocument, walkDocument } from "../asi/index.js";
import { BindRuleSets } from "./bind-rule-sets.js";
import { DocumentChecks } from "./document-checks.js";
import type { Findings } from "./findings.js";
import { FormatChecks } from "./formats.js";

/**
 * Runs the checks that hold for the elements of every kind of document, without the declarations of an item: the rule sets
 * of BIND §5, the formats of the text attributes, and the checks of {@link DocumentChecks}.
 */
export function checkElements(document: AsiDocument, findings: Findings): void {
  const bind = new BindRuleSets(findings, undefined);
  const formats = new FormatChecks(findings);
  const checks = new DocumentChecks(findings);
  walkDocument(document, (visit) => {
    checks.visit(visit);
    bind.visit(visit);
    formats.visit(visit);
  });
  formats.finish();
}
