/**
 * The terms of `ObjectTypeEnum`.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/ud-bind/index.html | QTI 3.0 Usage Data, ObjectTypeEnum}
 */
export const STATISTIC_OBJECT_TYPES = [
  "test",
  "testpart",
  "section",
  "item",
  "outcome",
  "interaction",
  "choice",
] as const;

/** The kind of object a statistic is about: a term of `ObjectTypeEnum`. */
export type ObjectType = (typeof STATISTIC_OBJECT_TYPES)[number];

/**
 * The terms of the "Distractor Statistics" external vocabulary, the names of the statistics about one response option.
 * A statistic may have another name, which a glossary then defines.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/ud-bind/index.html | QTI 3.0 Usage Data, external vocabularies}
 */
export const DISTRACTOR_STATISTICS: readonly string[] = [
  "AISResponse",
  "NumberChoosingResponse",
  "PTbis-Response",
  "PercentChoosingResponse",
];

/**
 * The terms of the "Item Statistics" external vocabulary, the names of the statistics about an item. A statistic may
 * have another name, which a glossary then defines.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/ud-bind/index.html | QTI 3.0 Usage Data, external vocabularies}
 */
export const ITEM_STATISTICS: readonly string[] = [
  "A-Param",
  "AIS",
  "B-Param",
  "C-Param",
  "D-Param",
  "Fifths_Table_Highest",
  "Fifths_Table_Lowest",
  "Fifths_Table_Middle",
  "Fifths_Table_Second_Highest",
  "Fifths_Table_Second_Lowest",
  "P-value",
  "PHI",
  "PTbis",
  "Polyserial",
  "Score_Conversion",
  "rbis",
];
