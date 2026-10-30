# PNP

`pnp` reads and writes the Personal Needs and Preferences (PNP) profile of a candidate in the QTI profile of PNP 3.0: the
supports a candidate needs, such as extra time, reading aloud or magnification. It also resolves what a profile asks for.
It imports `xml` only and runs in any JavaScript runtime. Deciding which candidate gets which support belongs to the
system that registers candidates; olah reads the decision.

| Export                                                                                                                                                                                                                                                                                | Purpose                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `readPnp(input)`                                                                                                                                                                                                                                                                      | Reads text, bytes or a parsed element into a `PersonalNeedsProfile`, or a bulk file into `PnpRecord[]`. |
| `writePnp(profileOrRecords)`                                                                                                                                                                                                                                                          | Writes a profile, or a bulk file of records, as a document that the PNP schema accepts.                 |
| `resolveSupports(profile)`                                                                                                                                                                                                                                                            | Returns the `SupportState` of each support the profile mentions.                                        |
| `SUPPORT_NAMES`, `isSupportName`, `isSetSupportName`, `extensionName`                                                                                                                                                                                                                 | The 40 predefined supports, and the names of supports.                                                  |
| `PNP_NAMESPACE`, `PNP_ALTERNATE_NAMESPACES`                                                                                                                                                                                                                                           | The schema's namespace and the two others that are read.                                                |
| `PersonalNeedsProfile`, `PnpRecord`, `PersonSourcedId`, `SupportState`                                                                                                                                                                                                                | The model.                                                                                              |
| `SupportSetting` and its members, `SupportName`, `PredefinedSupportName`, `SetSupportName`                                                                                                                                                                                            | The supports and their settings.                                                                        |
| `REPLACING_SUPPORTS`, `LANGUAGE_SUPPORTS`, `TOOL_SUPPORTS`, `OTHER_SUPPORTS`                                                                                                                                                                                                          | The names of the supports by shape.                                                                     |
| `PNP_ACCESS_MODES`, `PNP_HAZARDS`, `PNP_INPUT_REQUIREMENTS`, `PNP_READING_TYPES`, `PNP_RESTRICTION_TYPES`, `PNP_LINK_INDICATIONS`, `PNP_TYPING_ECHOES`, `PNP_BRAILLE_DELIVERY_MODES`, `PNP_BRAILLE_TYPES`, `PNP_BRAILLE_MATH_TYPES`, `PNP_GENERIC_FONT_FACES`, `PNP_CALCULATOR_TYPES` | The terms of the vocabularies; the type of the same meaning has no prefix, such as `HazardTerm`.        |

## Example

```ts
import { readPnp, resolveSupports, writePnp } from "@luthfanwakan/olah/pnp";

const profile = readPnp(`<access-for-all-pnp xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0pnp_v1p0">
  <spoken><reading-type>screen-reader</reading-type></spoken>
  <additional-testing-time><time-multiplier>1.5</time-multiplier></additional-testing-time>
  <activate-at-initialization-set><spoken/></activate-at-initialization-set>
  <prohibit-set><magnification/></prohibit-set>
</access-for-all-pnp>`);

if (!Array.isArray(profile)) {
  profile.supports.get("additional-testing-time");
  // { name: "additional-testing-time", replaceAccessModes: [], time: { kind: "time-multiplier", multiplier: 1.5 } }

  [...resolveSupports(profile)];
  // [["spoken", "active"], ["additional-testing-time", "assigned"], ["magnification", "prohibited"]]

  writePnp(profile); // the same profile, valid against the PNP schema, in the schema's namespace
}
```

## Model

| Type                   | Fields                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PersonalNeedsProfile` | `supports`: a `Map` from the name of a predefined support to its setting, in document order; `activateAsOption`, `activateAtInitialization`, `prohibited`: `Set`s of names; `extensions` |
| `PnpRecord`            | `personSourcedId`: `{ sourceSystem, id }`, `appointmentIds`, `profile`                                                                                                                   |
| `SupportState`         | `prohibited`, `active`, `option` or `assigned`                                                                                                                                           |

A setting has the `name` of its support, which is also its key in `supports`, and the parameters of that support.
`readPnp` returns a profile for `access-for-all-pnp` and an array of records for `access-for-all-pnp-records`;
`Array.isArray` tells them apart.

## Supports

Every support but the on-screen tools replaces content of some access modes: `replaceAccessModes` lists them, from
`auditory`, `color`, `item-size`, `olfactory`, `orientation`, `position`, `tactile`, `text-on-image`, `textual` and `visual`.

| Setting                 | Supports                                                                                                                                                                                                                                                                                                   | Parameters                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ReplacingSupport`      | `linguistic-guidance`, `keyword-emphasis`, `simplified-language-portions`, `simplified-graphics`, `encouragement`, `tactile`, `answer-masking`, `keyboard-directions`, `additional-directions`, `captions`, `transcript`, `alternative-text`, `audio-description`, `high-contrast`, `layout-single-column` | none                                                                                                                                                               |
| `LanguageSupport`       | `keyword-translation`, `item-translation`, `sign-language`                                                                                                                                                                                                                                                 | `language` (`xml:lang`, required)                                                                                                                                  |
| `LanguageOfInterface`   | `language-of-interface`                                                                                                                                                                                                                                                                                    | `languages`: one entry for each element, each with `language` and `replaceAccessModes`                                                                             |
| `HazardAvoidance`       | `hazard-avoidance`                                                                                                                                                                                                                                                                                         | `hazards`: one entry for each element: `flashing`, `sound`, `olfactory-hazard`, `motion-simulation` or an extension term                                           |
| `InputRequirements`     | `input-requirements`                                                                                                                                                                                                                                                                                       | `requirement`: `full-keyboard-control`, `full-mouse-control` or an extension term                                                                                  |
| `AdditionalTestingTime` | `additional-testing-time`                                                                                                                                                                                                                                                                                  | `time`: `{ kind: "time-multiplier", multiplier }`, `{ kind: "fixed-minutes", minutes }` or `{ kind: "unlimited" }`                                                 |
| `LineReader`            | `line-reader`                                                                                                                                                                                                                                                                                              | `highlightColor?`                                                                                                                                                  |
| `InvertDisplayPolarity` | `invert-display-polarity`                                                                                                                                                                                                                                                                                  | `foreground?`, `background?`                                                                                                                                       |
| `Magnification`         | `magnification`                                                                                                                                                                                                                                                                                            | `allContent?`, or `text?` and `nonText?`: each `{ zoomAmount? }`                                                                                                   |
| `Spoken`                | `spoken`                                                                                                                                                                                                                                                                                                   | `readingType?`, `restrictionTypes`, `speechRate?`, `pitch?`, `volume?` (at most 1), `linkIndication?`, `typingEcho?`                                               |
| `Braille`               | `braille`                                                                                                                                                                                                                                                                                                  | `language?`, `deliveryMode?`, `grade?` (1, 2 or 3), `brailleType?`, `mathType?`                                                                                    |
| `LongDescription`       | `long-description`                                                                                                                                                                                                                                                                                         | `hideVisually?`; absent means true                                                                                                                                 |
| `Environment`           | `environment`                                                                                                                                                                                                                                                                                              | `description?`, `medical?`, `software?`, `hardware?`, `breaks?`                                                                                                    |
| `TextAppearance`        | `text-appearance`                                                                                                                                                                                                                                                                                          | `backgroundColor?`, `fontColor?`, `fontSize?`, `fontFace?`, `lineSpacing?`, `lineHeight?`, `letterSpacing?`, `uniformFontSizing?`, `wordSpacing?`, `wordWrapping?` |
| `CalculatorOnScreen`    | `calculator-on-screen`                                                                                                                                                                                                                                                                                     | `calculatorType?`: `basic`, `standard`, `scientific`, `graphing` or an extension term                                                                              |
| `ToolSupport`           | `dictionary-on-screen`, `glossary-on-screen`, `thesaurus-on-screen`, `homophone-checker-on-screen`, `note-taking-on-screen`, `visual-organizer-on-screen`, `outliner-on-screen`, `peer-interaction-on-screen`, `spell-checker-on-screen`                                                                   | none                                                                                                                                                               |

- Colors are `#RGB` or `#RRGGBB`. Numbers are finite decimals; `speechRate`, `minutes` and the grade are integers.
- An extension term is `ext:` and letters, `|`, `.` or `_`: the pattern of the PNP schema. BPIG §5.2.1.2 writes
  `ext:iowa-reading`, which the schema's pattern does not allow because of the hyphen; olah follows the schema.
- `uniformFontSizing` and `wordWrapping` are empty elements, so the only value is `true`.
- A support occurs once in a document. `hazard-avoidance` and `language-of-interface` occur once for each hazard and each
  language, and `readPnp` joins the elements into one setting. Any other repeat is a `ReadError`.

## Sets

`activateAsOption`, `activateAtInitialization` and `prohibited` list supports by name alone; the parameters are in
`supports` (BPIG §5.3). A set can list 38 supports, all but `hazard-avoidance` and `environment` (`SetSupportName`). A
set that is empty is not written.

`resolveSupports(profile)` returns a `Map` from each support the profile mentions to its state (B69):

| State        | When                                                                                                       | Source      |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ----------- |
| `prohibited` | The support is in `prohibited`, even if the profile also assigns it: a prohibited support is not assigned. | BPIG §5.3.3 |
| `active`     | In `activateAtInitialization`: available as soon as the session starts.                                    | BPIG §5.3.2 |
| `option`     | In `activateAsOption`: available, and on only when the candidate asks.                                     | BPIG §5.3.1 |
| `assigned`   | The profile assigns it outside the sets, or it is a custom support: the delivery system provides it.       | BPIG §5     |

The first state that applies in this order wins. The map lists assigned supports first, then custom ones, then those that
only a set lists. A support the profile does not mention is not in the map.

## Custom supports

An element of another namespace as a child of the profile is a custom support (BPIG §5.4). `extensions` keeps it as an
`XmlElement`, and its name for catalogs and for the engine is `ext:` and its local name (`extensionName`): the element
`kxz:kxztesting-illustrated-glossary-on-screen` is the support `ext:kxztesting-illustrated-glossary-on-screen`. The
schema's wildcard (`##other`) requires a namespace, so an element in none is a `ReadError`. A set lists predefined
supports only; an element of another namespace in a set is a `ReadError`.

## Namespaces

`readPnp` reads the schema's namespace and the two others that 1EdTech's own documents use (D6): the examples of
BPIG §5 and the binding of BIND §7. `PNP_ALTERNATE_NAMESPACES` lists them. `writePnp` writes the schema's namespace and
names the schema in `xsi:schemaLocation`. `olah validate` reports a document in another namespace as an error (L15).

## Bulk files

`access-for-all-pnp-records` holds one record for each candidate and assignment (BPIG §5.5). A `PnpRecord` has the
`personSourcedId` with its required `source-system`, the `appointmentIds` that the profile is for, and the profile. The
schema allows several appointments; none means every assignment of the candidate. A bulk file needs at least one record.

## Errors

`readPnp` throws `ReadError` with one issue; `writePnp` and `resolveSupports` throw `DataError` for a model that is not a
profile: a field of the wrong type, a key that differs from the name of its setting, a name that no set can list, a
parameter outside its vocabulary, a list that must not be empty, or text with a character that XML 1.0 does not allow.
The codes are those of [results](results.md#errors) with the module `pnp`: `olah/pnp/not-pnp` for another root,
`missing-attribute` (`xml:lang`, `source-system`), `invalid-attribute`, `invalid-text`, `unexpected-attribute`,
`missing-element`, `unexpected-element`, `repeated-element` and `unexpected-text`.
