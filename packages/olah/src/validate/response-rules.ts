import type { ResponseProcessing, ResponseRule } from "../asi/index.js";
import { isQti2TemplateUri, STANDARD_TEMPLATES, standardTemplateUri } from "../processing/index.js";
import type { Findings } from "./findings.js";

/** The response processing of an item as it runs: its own rules, or the rules of the template it names. */
export interface ResponseRules {
  /** The rules in order; an `xi:include` is in them as the element it is. */
  readonly rules: readonly ResponseRule[];
  /** The element path of the response processing, for the location of issues. */
  readonly element: string;
  /** Whether the rules are all there are: false when the template names rules that could not be found. */
  readonly complete: boolean;
}

/**
 * Returns the rules that response processing runs and reports the template when it cannot be found. Its own rules win;
 * else the standard template its `template` names; else the rules the resolver returns for its `template-location`, or its
 * `template` when it has no location (INFO §4.6.1–2, B45). A QTI 2.x template URI names the template of the same algorithm
 * with a warning (G43); a URI that is neither standard nor resolved is an error (G17).
 *
 * @param processing - The response processing, absent when the item has none.
 * @param resolveTemplate - The host's resolver of templates, absent when it is not known: then a template that is not
 * standard cannot be found.
 * @returns The rules; `undefined` when the item has no response processing.
 */
export function responseRulesOf(
  processing: ResponseProcessing | undefined,
  resolveTemplate: ((uri: string) => ResponseProcessing | undefined) | undefined,
  findings: Findings,
  trail: string,
): ResponseRules | undefined {
  if (processing === undefined) return undefined;
  const element = `${trail}/qti-response-processing`;
  if (processing.rules.length > 0) return { rules: processing.rules, element, complete: true };
  const template = processing.template === "" ? undefined : processing.template;
  if (template !== undefined && isQti2TemplateUri(template)) {
    const message = `The response processing template ${JSON.stringify(template)} is a QTI 2.x address; olah applies the standard QTI 3.0 template of the same algorithm. Use a QTI 3.0 address.`;
    findings.warning("olah/validate/legacy-template", message, "BPIG §2.5.1", element);
  }
  const standard = template === undefined ? undefined : STANDARD_TEMPLATES.get(standardTemplateUri(template) ?? "");
  if (standard !== undefined) return { rules: standard.rules, element, complete: true };
  const location = processing.templateLocation ?? template;
  if (location === undefined) return { rules: [], element, complete: true };
  const resolved = resolveTemplate?.(location);
  if (resolved === undefined) {
    const message = `The response processing template ${JSON.stringify(location)} is not a standard template and the option resolveTemplate does not resolve it, so the item cannot be scored.`;
    findings.error("olah/validate/unknown-template", message, "INFO §4.6.1", element);
    return { rules: [], element, complete: false };
  }
  return { rules: resolved.rules, element, complete: true };
}
