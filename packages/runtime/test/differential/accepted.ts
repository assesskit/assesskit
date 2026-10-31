/** A difference from Longsight qti3-core that the specification settles in the runtime's favor, or leaves open. */
export interface AcceptedDifference {
  /** What differs, in a sentence. */
  readonly reason: string;
  /** The items it shows in, by the path of their files in the 1EdTech examples or by the name of a generated case. */
  readonly items: readonly string[];
  /** The variable that differs; absent when only one implementation accepts the item. */
  readonly variable?: string;
}

/** The differences that the comparison with Longsight sets aside. Every item listed shows the difference. */
export const ACCEPTED_DIFFERENCES: readonly AcceptedDifference[] = [
  {
    reason:
      "Longsight rejects a blockquote directly inside a gap match interaction, which the ASI schema allows. The content model does not affect processing, so the runtime runs the item.",
    items: [
      "items/shared-vocabulary/Items/Item_QTI3_Gap_Match_01/gap-match-qti3.xml",
      "items/shared-vocabulary/Items/Item_QTI3_Gap_Match_02/gap-match-qti3.xml",
      "items/shared-vocabulary/Items/Item_QTI3_Gap_Match_03/gap-match-qti3.xml",
      "packaging/BBQsTest/id-f8e13982226c/jumble-gapMatch.xml",
      "packaging/items/gap_match.xml",
      "packaging/items/multi-input.xml",
    ],
  },
  {
    reason:
      "Longsight wants a single interaction bound to RESPONSE for a standard template. The specification asks only that RESPONSE and SCORE are declared, so the runtime runs the template.",
    items: ["items/shared-vocabulary/Items/Item_QTI3_Hotspot_01/hotspot-qti3.xml", "packaging/items/media_coords.xml"],
  },
  {
    reason:
      "Longsight does not support the standard template CC2_match, one of the six that the specification names. The runtime has it built in.",
    items: [
      "packaging/ccPackage/testitems/QUE_102010.xml",
      "packaging/ccPackage/testitems/QUE_102011.xml",
      "packaging/ccPackage/testitems/QUE_102012.xml",
      "packaging/ccPackage/testitems/QUE_102013.xml",
      "packaging/ccPackage/testitems/QUE_102015.xml",
      "packaging/ccPackage/testitems/QUE_104045.xml",
      "packaging/ccPackage/testitems/QUE_104047.xml",
      "packaging/ccPackage/testitems/QUE_104048.xml",
      "packaging/ccPackage/testitems/QUE_104049.xml",
      "packaging/ccPackage/testitems/QUE_104051.xml",
    ],
  },
  {
    reason:
      "The item uses the custom operator org.qtitools.mathassess.CasProcess, which nobody registered. The runtime raises a processing error where Longsight goes on.",
    items: ["packaging/BBQsTest/id-bd44a757f562/SineRule-001.xml"],
  },
  {
    reason:
      "Longsight rejects the item because one rule sets the multiple-valued FEEDBACK to a single value. The runtime checks a value when its rule runs, and this case does not reach that rule; validation reports it.",
    items: ["packaging/items/feedback_adaptive.xml"],
  },
  {
    reason:
      "A number of a qti-index or a qti-repeat names a template variable, which the schema allows in place of an integer. Longsight rejects the reference and the runtime reads it.",
    items: ["packaging/items/mc_calc3.xml", "packaging/items/mc_stat2.xml"],
  },
  {
    reason:
      "A rule sets the correct response of a float to an integer. The runtime promotes the integer to a float when it assigns it, and Longsight rejects the rule.",
    items: ["packaging/items/template.xml"],
  },
  {
    reason:
      "Longsight starts no further attempt of a non-adaptive item once its completion status is completed. The runtime counts every attempt that starts, and completion closes only the session of an adaptive item.",
    items: ["a non-adaptive item that completes"],
    variable: "numAttempts",
  },
];

/**
 * Tells whether a difference is one of the accepted ones: it is on a listed item, whether the case is the item without
 * responses, with its correct responses or as a session of turns, and on the variable that the entry names.
 *
 * @param item - The name of the case, or of the turn of a session, that differs.
 * @param variable - The variable that differs; empty for an item that only one implementation accepts.
 */
export function isAccepted(accepted: readonly AcceptedDifference[], item: string, variable: string): boolean {
  return accepted.some(
    (entry) => (entry.variable ?? "") === variable && entry.items.some((listed) => showsIn(listed, item)),
  );
}

/** Tells whether the name of a case or a turn is that of a listed item, followed by what the case adds in parentheses. */
export function showsIn(listed: string, name: string): boolean {
  return name === listed || name.startsWith(`${listed} (`);
}
