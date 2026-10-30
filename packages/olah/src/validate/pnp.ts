import { checkRecord } from "../checks.js";
import type { Issue } from "../errors.js";
import { type PersonalNeedsProfile, PNP_ALTERNATE_NAMESPACES, PNP_NAMESPACE } from "../pnp/index.js";
import type { XmlElement } from "../xml/index.js";
import { Findings } from "./findings.js";

/** The sets of a profile (BPIG §5.3). */
const SETS = "BPIG §5.3";
/** The prohibit set (BPIG §5.3.3). */
const PROHIBIT_SET = "BPIG §5.3.3";

/**
 * Validates a personal needs profile (BPIG §5.3): a support in the prohibit set is listed only there. A support that the
 * profile also assigns is a recommendation broken, and one that an activate set also lists is a contradiction. A support
 * in both activate sets is on from the start and also an option, which the profile cannot mean.
 *
 * | Code                           | Severity | Reported when                                  |
 * | ------------------------------ | -------- | ---------------------------------------------- |
 * | `olah/validate/pnp-prohibited` | error    | a prohibited support is in an activate set     |
 * | `olah/validate/pnp-prohibited` | warning  | a prohibited support is also assigned          |
 * | `olah/validate/pnp-sets`       | warning  | a support is in both activate sets             |
 *
 * @param profile - The profile, as `readPnp` reads it.
 * @returns The issues; none when the profile is valid.
 * @throws `DataError` when `profile` is not an object of the model of a personal needs profile.
 */
export function validatePnp(profile: PersonalNeedsProfile): readonly Issue[] {
  checkRecord(profile, "The profile must be an object of the model of a personal needs profile");
  const findings = new Findings();
  const element = "access-for-all-pnp";
  for (const name of profile.prohibited) {
    if (profile.activateAsOption.has(name) || profile.activateAtInitialization.has(name)) {
      const message = `The support ${name} is in the prohibit set and in an activate set; the only listing of a prohibited support must be in the prohibit set.`;
      findings.error("olah/validate/pnp-prohibited", message, PROHIBIT_SET, element);
    }
    if (profile.supports.has(name)) {
      const message = `The support ${name} is in the prohibit set and the profile also assigns it; a prohibited support should not be assigned.`;
      findings.warning("olah/validate/pnp-prohibited", message, PROHIBIT_SET, element);
    }
  }
  for (const name of profile.activateAsOption) {
    if (!profile.activateAtInitialization.has(name)) continue;
    const message = `The support ${name} is in the activate-as-option set and the activate-at-initialization set; it is either on from the start or an option the candidate turns on.`;
    findings.warning("olah/validate/pnp-sets", message, SETS, element);
  }
  return findings.issues;
}

/**
 * Reports the elements of a PNP document that are in one of the two namespaces that 1EdTech's own documents use
 * instead of the schema's (D6, L15): those of the examples of BPIG §5 and of BIND §7. `readPnp` reads them, `writePnp`
 * writes the namespace of the schema, and the document is an error because the schema does not validate it. One issue
 * is reported for each element whose parent is not in such a namespace.
 *
 * @param root - The root element of the document, as `parseXml` returns it.
 * @returns One error for each part of the document in an alternate namespace; none when it uses the namespace of the schema.
 * @throws `DataError` when `root` is not an element.
 */
export function validatePnpNamespace(root: XmlElement): readonly Issue[] {
  checkRecord(root, "The root must be an element as parseXml returns it");
  const findings = new Findings();
  const visit = (element: XmlElement, parent: string, parentAlternate: boolean): void => {
    const alternate = PNP_ALTERNATE_NAMESPACES.includes(element.namespace);
    const path = `${parent}${element.name}`;
    if (alternate && !parentAlternate) {
      const message = `The element ${element.name} is in the namespace ${element.namespace}, which is not the namespace of the PNP schema. Use ${PNP_NAMESPACE}.`;
      findings.error("olah/validate/pnp-namespace", message, "BPIG §5, BIND §7", path);
    }
    for (const child of element.children) if (child.kind === "element") visit(child, `${path}/`, alternate);
  };
  visit(root, "", false);
  return findings.issues;
}
