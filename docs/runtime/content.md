# Content

`@assesskit/runtime/content` decides what an item shows. It hides what an outcome or a template variable hides, prints
variables with the number formats of the C `printf`, selects the rubric of a view and the card of a catalog, and maps the hazards of a
resource to the terms of a PNP. It imports `values`, `asi` and `pnp` and runs in any JavaScript runtime. It does not
render: it returns the nodes and the text that a renderer draws.

| Export                                                                      | Purpose                                                                                   |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `resolveContent(nodes, variables, item, options)`                           | The nodes with hidden content removed, variables printed and template values substituted. |
| `isShown(showHide, identifier, value)`                                      | Whether feedback, template content or a choice is visible (INFO §5.93.2).                 |
| `formatPrintedVariable(printed, value, variables)`                          | The text of a `qti-printed-variable`.                                                     |
| `visibleModalFeedback(item, outcomes)`                                      | The modal feedback an item shows.                                                         |
| `visibleTestFeedback(feedback, outcomes, access)`                           | The test feedback of one access, `during` or `atEnd`.                                     |
| `rubricBlocksFor(blocks, view)`                                             | The rubric blocks whose `view` lists the view.                                            |
| `testRubricBlocks(position, view)`                                          | The rubric of a test, its part and its sections, in the order the candidate meets it.     |
| `selectCard(catalog, support, language?)`                                   | The content of the card for a support, by language.                                       |
| `catalogsFor(item, node)`                                                   | The catalogs that `data-catalog-idref` of a node names.                                   |
| `checkCatalog(catalog)`                                                     | `Issue`s for a catalog that breaks the rules of cards.                                    |
| `hazardExposure(hazards, profile?)`                                         | The hazards of a resource in the terms of a PNP, each marked avoided or not (B99).        |
| `HAZARD_TERMS`, `VIEWS`                                                     | The map from a DRD hazard term to the PNP term, and the six views.                        |
| `ContentVariables`, `View`, `TestPosition`, `CardContent`, `HazardExposure` | The types.                                                                                |

## Example

```ts
import { readAsi } from "@assesskit/runtime/asi";
import { resolveContent } from "@assesskit/runtime/content";
import { createItemVariables } from "@assesskit/runtime/processing";
import { single } from "@assesskit/runtime/values";

const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="result" title="Result" time-dependent="false">
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier"/>
  <qti-template-declaration identifier="N" cardinality="single" base-type="integer"/>
  <qti-item-body>
    <p>Score <qti-printed-variable identifier="SCORE" format="%.1f"/> out of <qti-printed-variable identifier="N"/>.</p>
    <qti-feedback-block outcome-identifier="FEEDBACK" identifier="right" show-hide="show">
      <qti-content-body><p>Well done.</p></qti-content-body>
    </qti-feedback-block>
  </qti-item-body>
</qti-assessment-item>`);

if (document.kind === "item") {
  const { item } = document;
  const session = createItemVariables(item);
  const outcomes = new Map(session.outcomes)
    .set("SCORE", single("float", 0.7))
    .set("FEEDBACK", single("identifier", "right"));
  const templates = new Map(session.templates).set("N", single("integer", 4));
  const resolved = resolveContent(item.body?.children ?? [], { outcomes, templates }, item, { view: "candidate" });
  resolved.map(({ kind }) => kind); // ["p", "feedback-block"]
  // The paragraph reads "Score 0.7 out of 4." and the feedback is kept because FEEDBACK names "right".
}
```

## Visibility

`isShown` is the rule of INFO §5.93.2: with `show` the content is hidden by default and shown when the variable matches or
contains the identifier; with `hide` it is shown by default and hidden when the variable matches or contains it. A variable
that is NULL or not of base type identifier names nothing. The same rule governs feedback (an outcome), template blocks and
inlines (a template variable) and choices, gaps, hotspots and hot texts that have a `template-identifier`.

`resolveContent` applies it to a tree and does the rest of the work of presenting content:

| Content                                                          | Resolution                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `qti-printed-variable`                                           | text; an outcome or a template variable prints, a response variable prints nothing (INFO §7.30.6) |
| `qti-feedback-block`, `qti-feedback-inline`                      | kept when shown for the outcome, else removed                                                     |
| `qti-template-block`, `qti-template-inline`                      | kept when shown for the template variable, else removed                                           |
| choices, gaps, hotspots and hot texts with `template-identifier` | removed when the template variable hides them                                                     |
| `qti-rubric-block`                                               | kept when its `view` lists the view of the options, else removed                                  |
| `param` of an `object`                                           | its `value` replaced by the template variable it names, if declared with `param-variable`         |
| `mi` and `ci` of MathML                                          | replaced by `mn` and `cn` with the value of the template variable they name, if `math-variable`   |

Kept elements keep their order and get their content resolved in turn. The input is not changed. A substituted value is
written as an identifier, string or uri as it is, an integer by `%i`, a float or duration by `%G`, a boolean as `true` or
`false`, a point as `x y` and a pair as `a b`; a NULL variable, a container or a file leaves the parameter or the MathML
identifier as authored (INFO §7.29.2).

The visibility of integrated feedback after the last attempt (INFO §7.19.2, §7.19.3) is a matter of which outcomes are
given. For a non-adaptive item the body without feedback is the body at the start of the attempt, which the default
values of the outcomes give; with feedback it is the outcomes after response processing. The delivery engine decides.

## Printed variables

`formatPrintedVariable` writes a value as text. `format` is one conversion of the C `printf` ([BPIG] App. E): `%`, flags,
a width, a precision and one of `E e f G g r R i o X x`. Any other text, such as `%d`, `%s` or a specifier with text around
it, is ignored and the default is used.

| Part        | Meaning                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| flags       | `-` left align, `+` always a sign, space a space for a positive number, `#` alternate form, `0` pad with zeros                                          |
| width       | the least number of characters                                                                                                                          |
| precision   | digits after the point for `f`, `e` and `E`; significant digits for `g`, `G`, `r` and `R`; least digits for `i`, `o`, `x`, `X`                          |
| `e` `E`     | scientific notation, `9.876540e+02`                                                                                                                     |
| `f`         | fixed notation, `987.654000`                                                                                                                            |
| `g` `G`     | the shorter of the two, with trailing zeros removed unless `#` is set                                                                                   |
| `r` `R`     | as `g` and `G`, but fixed notation also for small numbers: `0.0000987654`; scientific only when the figures are fewer than the digits left of the point |
| `i`         | an integer in `base` (2 to 36, an integer or the identifier of a variable that holds one; 10 by default)                                                |
| `o` `x` `X` | an integer in base 8 or 16                                                                                                                              |

Numbers are rounded from their exact binary value, a tie to the even digit, as the C library does, so that `%.0f` of 2.5 is
`2`. A float with an integer conversion is truncated. Without `format`, an integer is written by `%i` and a float or a
duration by `%G`. The rest follows INFO §7.30:

- `power-form="true"` writes the exponent of a number as ` × 10` and a superscript: `1.5e+03` is `1.5 × 10³`.
- A container writes its values with `delimiter`, `;` by default. An ordered container writes only the value at `index`,
  counting from 1.
- A record writes `field`, or every field as the name, `mapping-indicator` (`=` by default) and the value.
- NULL is the empty string; a file is its name; a point is `x y` and a pair `a b`.

## Rubric

`rubricBlocksFor` keeps the blocks whose `view` lists the view: `author`, `candidate`, `proctor`, `scorer`,
`testConstructor` or `tutor`. `testRubricBlocks` joins the rubric of the test, its test part and the sections from the top
section down, each level in its own order. A rubric block cannot contain an interaction or another rubric block (INFO
§2.8.6): the reader refuses it.

## Catalogs and cards

`selectCard` takes the card of the support. A card without card entries gives its own content; with entries it gives the
entry whose `xml:lang` is the language, ignoring case, then the first entry with the same primary language (`fr` for
`fr-CA`), then the entry marked `default`. The content is HTML or references to files in the package. `catalogsFor` finds
the catalog that `data-catalog-idref` names wherever the item keeps it.

`checkCatalog` returns `Issue`s (BPIG §3.7.10):

| Code                                        | Reported when                                                    |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `assesskit/content/duplicate-card`          | two cards of the catalog have the same `support` (INFO §5.26.1)  |
| `assesskit/content/empty-card`              | a card or a card entry has no HTML content and no file reference |
| `assesskit/content/duplicate-default-entry` | more than one entry of a card is the `default` (INFO §5.27.2)    |

## Hazards

A resource lists its hazards in the terms of the DRD, and a PNP lists the hazards a candidate avoids in its own terms.
`HAZARD_TERMS` maps `flashing` and `sound` to themselves, `olfactoryHazard` to `olfactory-hazard` and `motionSimulation`
to `motion-simulation`. `hazardExposure(hazards, profile)` returns each hazard of the resource in the PNP term with
`avoided` set when the profile lists it under `hazard-avoidance`. A candidate who avoids a hazard should not be exposed to
content that has it: the delivery engine picks a variant without the hazard (B100) and flags the hazards it cannot avoid.

## Companion materials

The calculators, rulers, protractors, digital materials and physical materials of an item are data of the model: read them
from `item.companionMaterials`. The calculator types are `basic`, `graphing`, `scientific` and `standard`; a metric ruler
measures in `Millimeter`, `Centimeter`, `Meter` and `Kilometer`, a ruler in US units in `Inch`, `Foot`, `Yard` and `Mile`,
a protractor in SI units in `Radian`, and one in US units in `Degree`, `Minute` and `Second`. The reader refuses any other
term.

## Evidence

The tests check the formatting against the specification's table, against 1,675 cases that Python's `%` operator writes
(`validation/printf.py`), and with properties; they resolve every item of the 1EdTech examples and check the MathML
substitution on one that uses it.
