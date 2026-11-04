import { HAZARD_TERMS } from "../content/internal.js";
import type { PnpHazard } from "../pnp/index.js";
import type { Candidate } from "./course.js";
import type { CandidateNeeds } from "./delivery-state.js";

/** The item an instance presents, and the hazards it has that the candidate avoids. */
export interface VariantChoice {
  /** The item itself or one of its variants. */
  readonly candidate: Candidate;
  /** The hazards of the item presented that the candidate avoids: none unless every candidate has such a hazard. */
  readonly unavoidable: readonly PnpHazard[];
}

/** Returns the hazards of a candidate that the candidate avoids, in the terms of the PNP. */
function avoidedIn(candidate: Candidate, avoided: ReadonlySet<PnpHazard>): PnpHazard[] {
  return candidate.hazards.flatMap((hazard) => {
    const term = HAZARD_TERMS.get(hazard);
    return term !== undefined && avoided.has(term) ? [term] : [];
  });
}

/** Returns the primary subtag of a BCP 47 tag, in lower case: tags ignore case (RFC 5646). */
function primarySubtag(tag: string): string {
  return tag.toLowerCase().split("-")[0] ?? "";
}

/**
 * Chooses what an item instance presents, at its first presentation.
 *
 * @remarks
 * The candidates are the item and its variants. Every candidate with a hazard that the candidate avoids is dropped.
 * Among the rest, a variant whose `languageOfAdaptation` is the language of `item-translation` is preferred, by the
 * whole tag, then by the primary subtag; else the item itself, or the first variant left when the item was dropped.
 * When every candidate is dropped, the item itself is presented, and its avoided hazards are unavoidable.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export function chooseVariant(candidates: readonly [Candidate, ...Candidate[]], needs: CandidateNeeds): VariantChoice {
  const avoided = new Set(needs.avoidedHazards);
  const [own] = candidates;
  const safe = candidates.filter((candidate) => avoidedIn(candidate, avoided).length === 0);
  const [first] = safe;
  if (first === undefined) return { candidate: own, unavoidable: avoidedIn(own, avoided) };
  const { translation } = needs;
  if (translation !== undefined) {
    const variants = safe.filter((candidate) => candidate !== own);
    const wanted = translation.toLowerCase();
    const match =
      variants.find((variant) => variant.languages.some((tag) => tag.toLowerCase() === wanted)) ??
      variants.find((variant) => variant.languages.some((tag) => primarySubtag(tag) === primarySubtag(wanted)));
    if (match !== undefined) return { candidate: match, unavoidable: [] };
  }
  return { candidate: safe.includes(own) ? own : first, unavoidable: [] };
}
