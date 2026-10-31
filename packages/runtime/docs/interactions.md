# Interactions

`@assesskit/runtime/interactions` describes the interactions of an item for the delivery engine and the player, checks
that their response variables suit them, decides whether a response is valid, draws the order of the choices, and reads
the numbers that a candidate types. It imports `values` and `asi` and runs in any JavaScript runtime. It does not render
an interaction: the content of the choices stays in the body of the item (INFO §2.4).

| Export                                   | Purpose                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `describeInteractions(item)`             | The `InteractionDescriptor` of each interaction of the item, in document order.                            |
| `checkBindings(item)`                    | `Issue`s for response variables that the interactions do not accept.                                       |
| `checkResponse(descriptor, response)`    | The `ResponseStatus` of a response and the `ResponseViolation`s it has.                                    |
| `answeredStatus(descriptors, responses)` | The status of an item from the responses to all its interactions (RR §2.7.1).                              |
| `initialResponse(descriptor, default)`   | The response an interaction starts with, given the default value of its variable.                          |
| `shuffleChoices(descriptor, random)`     | The initial order of the choices, one list of identifiers for each set of choices.                         |
| `presentChoices(descriptor, orders)`     | The descriptor with the choices in the given orders, and without those that the orders leave out.          |
| `numericRecord(text, base?)`             | The record that a text interaction bound to a record gives for the text a candidate typed (INFO §2.4.2.2). |
| `InteractionKind`                        | The 22 kinds of interaction, such as `"choice-interaction"`.                                               |
| `Binding`, `ChoiceDescriptor`            | A cardinality with its base types; one choice, gap, hotspot or hot text.                                   |
| `InteractionConstraints`                 | What a valid response needs.                                                                               |
| `ResponseCheck`, `ResponseStatus`        | The result of `checkResponse`, and `answered`, `attempted` or `presented`.                                 |

## Example

```ts
import { createRandom } from "@assesskit/runtime";
import { readAsi } from "@assesskit/runtime/asi";
import { checkResponse, describeInteractions, presentChoices, shuffleChoices } from "@assesskit/runtime/interactions";
import { container } from "@assesskit/runtime/values";

const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="capital" title="Capital" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="multiple" base-type="identifier"/>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" shuffle="true" min-choices="1" max-choices="2">
      <qti-simple-choice identifier="Paris">Paris</qti-simple-choice>
      <qti-simple-choice identifier="Lyon" fixed="true">Lyon</qti-simple-choice>
      <qti-simple-choice identifier="Nice">Nice</qti-simple-choice>
      <qti-simple-choice identifier="Metz">Metz</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
</qti-assessment-item>`);

if (document.kind === "item") {
  const [descriptor] = describeInteractions(document.item);
  if (descriptor) {
    descriptor.constraints; // { minChoices: 1, maxChoices: 2 }
    descriptor.bindings; // [{ cardinality: "multiple", baseTypes: ["identifier"] }]

    const orders = shuffleChoices(descriptor, createRandom(42)); // [["Metz", "Lyon", "Paris", "Nice"]]: Lyon stays second
    const hidden = new Set(["Nice"]); // a template variable hides Nice
    presentChoices(descriptor, [orders[0]?.filter((identifier) => !hidden.has(identifier)) ?? []]).choices.map(
      ({ identifier }) => identifier,
    ); // ["Metz", "Lyon", "Paris"]

    checkResponse(descriptor, container("multiple", "identifier", ["Paris", "Nice", "Metz"]));
    // { status: "attempted", reasons: ["max-choices"] }
    checkResponse(descriptor, container("multiple", "identifier", ["Paris"])); // { status: "answered", reasons: [] }
    checkResponse(descriptor, null); // { status: "presented", reasons: ["min-choices"] }
  }
}
```

## Descriptors

`describeInteractions` reads the body of the item, including feedback, tables and the position object stage, and gives
one descriptor for each interaction. The descriptor holds what the rules of validity, shuffling and visibility read; the
prompt, the images and the content of the choices stay in the `BodyNode`s.

| Field                | Meaning                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `kind`               | The kind of interaction.                                                                                                   |
| `responseIdentifier` | The response variable it binds.                                                                                            |
| `declaration`        | The declared cardinality and base type of that variable; absent when the item does not declare it.                         |
| `bindings`           | The bindings the interaction accepts, narrowed by its attributes.                                                          |
| `choices`            | Every choice in document order. A match interaction lists the first set, then the second.                                  |
| `matchSets`          | The two sets that a response pairs, as directed pairs from the first to the second: see below. Absent for the other kinds. |
| `constraints`        | What a valid response needs.                                                                                               |
| `shuffle`            | Whether the initial order is random.                                                                                       |
| `stringIdentifier`   | The second response variable of a text interaction that keeps the text as typed.                                           |

A `ChoiceDescriptor` has the `identifier`, `fixed`, `templateIdentifier` and `showHide` (which hide the choice when a
template variable says so, INFO §2.7.1), and for the choices that take associations `matchMax`, `matchMin` and
`matchGroup`, and for a gap `required`. A maximum of 0, which means no restriction, and a minimum of 0 are left out.

| Kind                                                           | `choices`                               | `matchSets`                   |
| -------------------------------------------------------------- | --------------------------------------- | ----------------------------- |
| `choice`, `order`, `inline-choice`, `hotspot`, `graphic-order` | the choices, hotspots or inline choices | absent                        |
| `hottext`                                                      | the hot texts in the running text       | absent                        |
| `associate`, `graphic-associate`                               | the associable choices or hotspots      | absent                        |
| `match`                                                        | both sets                               | the two sets                  |
| `gap-match`                                                    | the gap choices, then the gaps          | the gap choices, the gaps     |
| `graphic-gap-match`                                            | the gap choices, then the hotspots      | the gap choices, the hotspots |
| the others                                                     | none                                    | absent                        |

## Bindings

The bindings are those of INFO §2.4. A record has no base type, so its list of base types is empty.

| Kind                              | Accepts                                                       |
| --------------------------------- | ------------------------------------------------------------- |
| `choice`, `hottext`, `hotspot`    | single or multiple identifier                                 |
| `order`, `graphic-order`          | ordered identifier                                            |
| `inline-choice`                   | single identifier                                             |
| `associate`, `graphic-associate`  | single or multiple pair                                       |
| `match`, `gap-match`              | single or multiple directed pair                              |
| `graphic-gap-match`               | multiple directed pair                                        |
| `select-point`, `position-object` | single or multiple point                                      |
| `text-entry`                      | single float, integer or string, or a record                  |
| `extended-text`                   | the same, and multiple or ordered when `max-strings` is given |
| `slider`                          | single float or integer                                       |
| `media`                           | single integer (the number of plays)                          |
| `drawing`, `upload`               | single file                                                   |
| `end-attempt`                     | single boolean                                                |
| `custom`, `portable-custom`       | any cardinality with any base type                            |

A single value is accepted only when the interaction takes at most one value: `max-choices` or `max-associations` above 1
or 0 needs a container (INFO §5.30.2), and so do several gaps (INFO §5.57.8). A gap match or graphic gap match
interaction without `max-associations` has no limit, where the schema's default is 1: the examples of 1EdTech leave it out
with several gaps, and each gap takes one choice.

`checkBindings(item)` returns an `Issue` for each violation:

| Code                                          | Reported when                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `assesskit/interactions/response-undeclared`  | an interaction names a response variable that the item does not declare                 |
| `assesskit/interactions/binding`              | the variable has a cardinality or base type that the interaction does not accept        |
| `assesskit/interactions/response-bound-twice` | a variable is bound to more than one interaction, including through `string-identifier` |
| `assesskit/interactions/string-identifier`    | `string-identifier` names a variable that is not declared as a single string            |

## Validity

`checkResponse` applies the rules of INFO §5.30 to §5.165 to the descriptor of the interaction as it is presented: give it
the descriptor that `presentChoices` returns, so that hidden choices are not demanded.

| Reason             | The response ...                                                                      |
| ------------------ | ------------------------------------------------------------------------------------- |
| `binding`          | has a cardinality or base type that the interaction or the declaration does not allow |
| `unknown-choice`   | names an identifier that is not a choice, or pairs choices that cannot be paired      |
| `repeated-choice`  | names a choice twice where it can be given once                                       |
| `min-choices`      | has fewer choices, hotspots or points than `min-choices`                              |
| `max-choices`      | has more than `max-choices`                                                           |
| `min-associations` | has fewer associations than `min-associations`                                        |
| `max-associations` | has more than `max-associations`                                                      |
| `match-min`        | uses a choice fewer times than its `match-min`                                        |
| `match-max`        | uses a choice more times than its `match-max`, or a gap more than once                |
| `match-group`      | pairs a choice with one that its `match-group` leaves out                             |
| `required`         | leaves out a choice that is `required`, or a gap that must be filled                  |
| `min-strings`      | has fewer non-empty strings than `min-strings`                                        |
| `max-strings`      | has more than `max-strings`                                                           |
| `pattern-mask`     | has a string that the `pattern-mask` does not match                                   |
| `bounds`           | is outside the bounds of a slider                                                     |
| `step`             | is not on a step of a slider                                                          |
| `min-plays`        | counts fewer plays than `min-plays`                                                   |
| `max-plays`        | counts more plays than `max-plays`                                                    |
| `mime-type`        | is a file of a type that an upload does not accept                                    |

- An order interaction without `min-choices` needs every choice in the response, and its `max-choices` is ignored; with
  `min-choices` it needs between that and `max-choices`, up to all (INFO §5.97.2, §5.97.3).
- The `pattern-mask` is a pattern of XML Schema's regular expressions and runs on the linear-time automaton of `values`.
  A text bound to a number is not checked against it, because the text is not in the value.
- A slider bound to an integer rounds its lower bound down and its upper bound up, and steps by 1 unless `step` says
  otherwise (INFO §5.134).
- A MIME type is compared without its parameters and without regard to case.

The `status` follows RR §2.7.1: NULL is `presented`, even when it breaks a rule such as `min-choices`; a response without
violations is `answered` and any other is `attempted`. `answeredStatus` gives the item's status: `answered` when it has a
response and every interaction is valid (a blank optional interaction is valid), `presented` when it has no response, and
`attempted` otherwise. The end attempt interaction does not count. `notpresented`, for an item that was never shown, is
the engine's to report.

`initialResponse` gives the response an interaction starts with: the default value, except for a choice interaction, which
starts with nothing selected (INFO §2.4.1.1), and an end attempt interaction, which ignores its default (INFO §2.4.5). The
default of an order interaction overrides the initial order of its choices (INFO §2.4.1.2), so shuffle the choices of an
order only when its default is NULL.

## Shuffling

`shuffleChoices` returns one list of identifiers for each set of choices: the one set of most interactions, the two sets
of a match interaction, and the gap choices and the gaps or hotspots of a gap match and a graphic gap match interaction.
Only the choices are shuffled in the last two, and each set of a match interaction on its own (INFO §5.89.1, §5.57.1).

| Rule                 | Statement                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Draw procedure       | Fisher–Yates from the last index: for a set of n movable choices, one draw `floor(uniform() × (i + 1))` for i from n − 1 down to 1. |
| Fixed choices        | A choice with `fixed` keeps its position among all the choices of its set.                                                          |
| Hidden choices (G19) | Choices that a template variable hides are shuffled with the others and dropped afterward, so that fixed positions hold.            |
| Without `shuffle`    | The order of the document, and no draw.                                                                                             |

Changing the draw procedure is a breaking change. `presentChoices` drops the choices that an order leaves out, and the
orders the engine stores give the same descriptor again when a session resumes.

## Numeric text

`numericRecord(text, base?)` reads a typed number into the fields of INFO §2.4.2.2.

```ts
import { numericRecord } from "@assesskit/runtime/interactions";

const fields = numericRecord("12.50e-3")?.fields;
[...(fields ?? [])].map(([name, field]) => [name, field.value]);
// [["stringValue", "12.50e-3"], ["floatValue", 0.0125], ["leftDigits", 2], ["rightDigits", 2], ["ndp", 5], ["nsf", 4], ["exponent", -3]]
```

| Field          | Value                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `stringValue`  | the text, as typed                                                                                  |
| `floatValue`   | the number                                                                                          |
| `integerValue` | the number, when the text has no fractional digits and no exponent and the number is a safe integer |
| `leftDigits`   | the digits left of the point, as typed                                                              |
| `rightDigits`  | the digits right of the point, as typed                                                             |
| `ndp`          | `rightDigits` less the exponent, never below 0                                                      |
| `nsf`          | the digits from the first that is not 0 to the last, at least 1                                     |
| `exponent`     | the exponent, when the text has one                                                                 |

White space around the number is ignored. In base 10 the text is a decimal with sign, point and exponent; in another base,
2 to 36, it is an integer. Text that is no number has `stringValue` only, and the empty string is NULL.

## Evidence

The tests check the descriptors of the 251 items of the 1EdTech examples against a count of the interaction elements in
their markup, and the correct response of every example against the rules of validity. The differential tests compare
descriptors, the validity of generated responses and numeric records with Longsight `qti3-core`: they agree, but for the
integer value of a number that ends in its point, where the oracle gives none.
