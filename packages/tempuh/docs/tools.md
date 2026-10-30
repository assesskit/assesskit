# Tools

The tools of an item are what the item's companion materials ask the player to provide and what the candidate's profile
puts on the screen: a rule, a protractor, calculators, digital and physical materials, a line reader, answer masking and
the tools that the host provides, such as a dictionary. `mountTools` of `@luthfanwakan/tempuh/player` shows them.

| Tool                                                                                                         | Comes from                                            | Built in |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | -------- |
| Rule                                                                                                         | `qti-rule` (INFO §5.126)                              | yes      |
| Protractor                                                                                                   | `qti-protractor` (INFO §5.110)                        | yes      |
| Basic and standard calculators                                                                               | `qti-calculator` (INFO §5.24), `calculator-on-screen` | yes      |
| Scientific and graphing calculators                                                                          | the same                                              | host     |
| Digital material                                                                                             | `qti-digital-material` (INFO §5.80)                   | a viewer |
| Physical material                                                                                            | `qti-physical-material` (INFO §5.33)                  | a notice |
| Line reader                                                                                                  | `line-reader` ([CERT] A-27)                           | yes      |
| Answer masking                                                                                               | `answer-masking` (BPIG §5.2.9.4)                      | yes      |
| Dictionary, thesaurus, homophone checker, notes, visual organizer, outliner, peer interaction, spell checker | `*-on-screen` supports                                | host     |

## Mounting

```ts
import { readAsi } from "@luthfanwakan/olah/asi";
import { selectMessages } from "@luthfanwakan/tempuh";
import { mountTools } from "@luthfanwakan/tempuh/player";

declare const toolbar: HTMLElement; // in the page
declare const item: HTMLElement; // the rendered item; its position is not static
declare const itemXml: string; // the qti-assessment-item that the item shows

const tools = mountTools(toolbar, {
  messages: selectMessages("en"),
  language: "en",
  stage: item,
  assets: (path) => `https://assets.example/g/token/${path}`,
  slots: {
    dictionary: (host, { language }) => {
      host.textContent = `A dictionary for ${language}`;
      return () => host.replaceChildren();
    },
  },
  onSupport: (name, active) => {
    // Send the `support` action, then show the next view.
    console.log(name, active);
  },
});

const document = readAsi(itemXml);
if (document.kind !== "item") throw new Error("The document is not an item.");

tools.update({
  companion: document.item.companionMaterials ?? null,
  supports: [
    {
      name: "line-reader",
      state: "option",
      active: false,
      settings: { name: "line-reader", replaceAccessModes: [], highlightColor: "#336699" },
    },
  ],
});

tools.destroy();
```

`mountTools(host, options)` puts a region named Tools into `host`: a toolbar with a button for each tool, the physical
materials, and a tray with the panel of each open tool. The tools that lie over the item go into a layer that the mount
appends to `stage`. It adopts its stylesheet into the document or shadow root of `host` and of `stage`, and gives it back
on `destroy`.

| Option      | Type                                                       | Meaning                                                                                                                                     |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `messages`  | `Messages`                                                 | The text of the interface, from `selectMessages`.                                                                                           |
| `language`  | `string`                                                   | The language of the interface, a BCP 47 tag, which the tools of the host get.                                                               |
| `stage`     | `HTMLElement`                                              | The element that holds the rendered item, in a document or a shadow root. Its `position` must not be `static`.                              |
| `assets`    | `(path: string) => string`                                 | Turns the path of a file in the package into the URL to load it from.                                                                       |
| `slots`     | `Partial<Record<SlotTool, (host, options) => () => void>>` | The tools that the host provides, by name. A function builds the tool in `host` and returns the function that takes it down. Default: `{}`. |
| `onSupport` | `(name: SupportName, active: boolean) => void`             | Called when the candidate turns a tool of the profile that is an option on or off: the host sends the `support` action.                     |

`tools.update(input)` shows the tools for an item and a candidate. Call it with every new view. A tool that stays in force
stays open, where the candidate put it; the others go, and the focus goes to the button of a tool that took it down.
`tools.destroy()` takes everything down and leaves the item as it was.

`mountTools` and `update` throw `DataError` for a `host`, an option or an input of the wrong type. A function of `slots` that
throws, or that returns something other than a function, makes `update` throw after it has shown the other tools; its
panel is taken down.

### Input

`update` takes the companion materials of the item, or `null`, and the supports of the view: the `supports` of olah's
`CandidateView`, as they are. The supports that put no tool on the screen are ignored.

| Field                 | Meaning                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companion`           | The `CompanionMaterialsInfo` of olah's `asi` module, which `readAsi` gives as `item.companionMaterials`, or `null`                                                                                                                                                                                                                  |
| `supports[].name`     | The support. Those that put a tool on the screen are `line-reader`, `answer-masking`, `calculator-on-screen`, `dictionary-on-screen`, `thesaurus-on-screen`, `homophone-checker-on-screen`, `note-taking-on-screen`, `visual-organizer-on-screen`, `outliner-on-screen`, `peer-interaction-on-screen` and `spell-checker-on-screen` |
| `supports[].state`    | `prohibited`, `active`, `option` or `assigned` (BPIG §5.3), the `SupportState` of olah's `pnp` module                                                                                                                                                                                                                               |
| `supports[].active`   | Whether the tool is on now                                                                                                                                                                                                                                                                                                          |
| `supports[].settings` | The settings of the profile: `highlightColor` (`#RGB` or `#RRGGBB`) of `line-reader`, default the player's own; `calculatorType` of `calculator-on-screen`, a calculator type or an extension term, default `basic`                                                                                                                 |

The tools read these parts of the companion materials; olah keeps a decimal as the text that the document has, and tempuh
reads it as a number.

| Element                 | Parts read                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `qti-calculator`        | `calculatorType`, `description` and `calculatorInfo`                                          |
| `qti-rule`              | `description`, and of `ruleSystem` the `minimumLength`, `minorIncrement` and `majorIncrement` |
| `qti-protractor`        | `description`, and of `increment` the `minorIncrement` and `majorIncrement`                   |
| `qti-digital-material`  | `fileHref`, `label`, `mimeType` and `resourceIcon`                                            |
| `qti-physical-material` | the text                                                                                      |

`update` checks the parts it reads, and throws `DataError` for a model of another shape, such as one that a plain JavaScript
or JSON caller builds by hand. Units of length are `Millimeter`, `Centimeter`, `Meter`, `Kilometer`, `Inch`, `Foot`, `Yard`
and `Mile` (INFO §8.28, §8.40); units of angle are `Radian`, `Degree`, `Minute` and `Second` (INFO §8.27, §8.39).

## Tools in force

- The item's rules, protractors, calculators and digital materials are in force, and the physical materials are listed.
- Each support of the profile that is not `prohibited` puts its tool in force, whatever the item asks for: a candidate with
  `calculator-on-screen` has a calculator when the item has none ([CERT] A-12).
- A calculator that the item and the profile both name is one tool. The profile's `calculator-on-screen` without a type
  asks for a basic calculator, and with an extension term for no calculator that tempuh knows.
- A prohibited `calculator-on-screen` removes the item's calculators too: the profile says that the candidate may not use
  one (BPIG §5.2.9). A prohibited `line-reader`, `answer-masking` or other support removes that tool.
- The toolbar lists the item's tools in the order rule, protractor, calculator, digital material, then the profile's tools.
  Tools of one name are numbered: Ruler 1, Ruler 2.

A tool whose support is an `option` follows the `active` flag of the input, never the candidate's own request: pressing its
button calls `onSupport(name, !active)`, and the tool opens or closes when the next input says so. The focus then moves into
a tool that the candidate opened. olah turns only an option on and off (BPIG §5.3, `support-not-available`), so a tool whose
support is `active` or `assigned` is open at first when its `active` flag is on, and then the candidate opens and closes it
like a tool that only the item asks for, which opens and closes at once.

## The tools

Every tool has a panel in the tray with a heading, its description when the item gives one, and a button that closes it and
gives the focus back to the toolbar. Controls are at least 2.75rem square.

### Rule

A bar as long as `minimumLength` in the unit of the major increment, with a tick at each minor and major increment and
a number at each major tick, in the unit of the major increment, and the symbol of the unit at the bottom. It is drawn at
the size of CSS units (96 pixels to the inch) when it fits in the width of the stage less 32 pixels, and smaller, with the
same proportions, when it does not. Ticks closer than 3 pixels are left out, and numbers closer than 32 pixels are
thinned, so that an increment of a millionth of the length costs nothing.

### Protractor

A half circle that measures 180 degrees, with ticks at the minor and major increments along the arc, and numbers at the
major ticks on two rings: from the right end of the base line on the outer one, from the left end on the inner one. The
radius is half the width of the stage less 16 pixels, between 96 and 200. It turns about the center of its base line.

### Moving and turning

The rule and the protractor lie over the item and are placed by the candidate.

| Operation | Pointer                                                             | Keyboard, on the tool                                  |
| --------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| Move      | Drag the tool, or the four buttons of the panel (10 pixels)         | Arrow keys (10 pixels), with Shift 1 pixel             |
| Turn      | The two rotate buttons (5 degrees), or the angle field of the panel | Page Up and Page Down (5 degrees), with Shift 1 degree |

The angle field takes whole degrees; angles are kept between -180 and 180. A tool stays in the stage, which clips it. When
an element takes the focus and the tool would hide it, the tool moves out of its way.

### Line reader

A band of the profile's highlight color, 40 percent opaque, over one line of the item's text at a time. The lines come from
the text on the page, so the band follows wrapped text, resizing and changes of the item. It moves with Up and Down on the
band, Home and End, and the Previous line and Next line buttons of the panel, and it scrolls into view. The band takes no
pointer events and lets the text show through. An item without text has no band; the panel says so.

### Answer masking

The choices of every `qti-choice-interaction` in the stage are hidden, visually and to assistive technology, and a mask in
their place says so and has a button that shows them (BPIG §5.2.9.4). The mask covers an interaction that the renderer adds
later and comes back if the renderer removes it. The button stays, to hide the choices again; the focus stays on it. The
support's `active` flag turns masking on for the item and off again.

### Calculators

The basic calculator has the digits, the decimal point, the four operations, equals and clear. The standard calculator adds
memory (MC, MR, M+, M−), percent, square root and change of sign (BPIG §3.7.8.1). Operations run as they are entered, from
left to right, so 2 + 3 × 4 = gives 20. Results are rounded to 12 significant digits, and at most 12 digits can be typed.

| Key    | Result                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| %      | After + or −, that percent of the left operand (200 + 10 % is 200 + 20); after × or ÷, or alone, a hundredth |
| √, ÷   | An error for a negative number and for a division by zero; only clear takes the error away                   |
| ±      | Changes the sign of the number typed, or of the result                                                       |
| C      | Clears the calculation and keeps the memory                                                                  |
| M+, M− | Adds to or subtracts from the memory; a sign "Memory in use" shows while the memory is not 0                 |

The display is an `output` element, so that assistive technology reads each result. Typing works anywhere in the panel
except that Enter presses a focused button:

| Typed            | Key                |
| ---------------- | ------------------ |
| `0` to `9`       | digits             |
| `.` or `,`       | decimal point      |
| `+` `-` `*` `/`  | the operations     |
| `=` or Enter     | equals             |
| `%`              | percent (standard) |
| Escape or Delete | clear              |

The item can say where a calculator is available: `qti-calculator-info` names a file of the package, which is content for
the candidate (INFO §5.24.3, §5.80). The panel of a built-in calculator shows that file below the keys, in the viewer of
the digital materials, and the panel of a host's tool that has no function shows it below the notice. The tool that the
host builds gets it in `options.file`. The `description` of the calculator is shown above the keys.

### Digital materials

A button opens a viewer for the file of the package, by the URL that `assets` gives. The button has the label of the
material, or the name of its file, and its icon. The viewer shows the file by its media type, and runs nothing of it:

| Media type             | Viewer                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| `image/*`              | an image, with the label as its alternative text                        |
| `audio/*`, `video/*`   | the element, with controls                                              |
| `text/html`            | a frame with an empty `sandbox`                                         |
| anything else, or none | a link that opens in a tab of its own, with `rel="noopener noreferrer"` |

A path with a scheme is not a package path: nothing is loaded, and the panel says that the tool is not available. The
viewer is also the one of the file of a calculator.

### Physical materials

The descriptions are listed under the heading "Materials to have ready", as text.

### Tools of the host

Each tool of the host has a button and a panel, and `slots[name](host, options)` builds the tool in the panel.
The names are `scientific-calculator`, `graphing-calculator`, `dictionary`, `thesaurus`, `homophone-checker`,
`note-taking`, `visual-organizer`, `outliner`, `peer-interaction` and `spell-checker`. The function returns the function
that takes the tool down, which runs when the tool closes and on `destroy`. A tool without a function says that it is not
available. Host tools are not built in: tempuh does not test them.

| Option     | Meaning                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`     | The tool that the host builds                                                                                                              |
| `language` | The language of the interface, a BCP 47 tag                                                                                                |
| `file`     | For a calculator, the file at which the item says it is available, as `{ url, mimeType, label }` (`url` from `assets`), or `null` for none |

## Accessibility

| Criterion                           | How the tools meet it                                                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1.1 Keyboard                      | Every tool and every control works by keyboard: the toolbar, the panels, the keys of the tools above, the calculator by typing                                                      |
| 2.1.4 Character Key Shortcuts       | The typing of the calculator, and the keys of a tool, work only while the focus is in that tool                                                                                     |
| 2.4.11 Focus Not Obscured (Minimum) | The line reader and the masks hide no element that can take focus; the rule and the protractor move away from one that they would hide; panels are in the tray, never over the item |
| 2.5.7 Dragging Movements            | Every move and turn has buttons and keys, the line reader has no drag                                                                                                               |
| 2.5.8 Target Size (Minimum)         | Buttons and fields are at least 2.75rem by 2.75rem                                                                                                                                  |
| 2.5.3 Label in Name                 | A key's name starts with the letters on it: "MC, clear memory"; symbols such as ÷ are named by what they do                                                                         |

The stylesheet uses system colors, so that the tools follow the color scheme and the forced colors of the browser.

## Reading of the specifications

- A rule is exactly `minimumLength` long, in the unit of the major increment (INFO §5.127.1).
- The numbers of a rule and a protractor are in the unit of the major increment; the unit symbols are not translated.
- A protractor measures 180 degrees.
- `qti-calculator-info` is content for the candidate: INFO §5.24.3 says that the calculator is available at the location it names, and §5.80 that the file is information "to be made available to the learner". tempuh builds the basic and standard calculators in and takes the other types from the host, so it shows the file and gives it to the host's tool, and never runs it. It is not metadata, and it does not change the type of calculator.
- Only `qti-choice-interaction` is masked: BPIG §5.2.9.4 requires masks for choice interactions only.
- A digital material that is an LTI resource (BPIG §6.2.9.9) is a file here; the LTI launch belongs to the platform role.
- The display of a calculator uses a decimal point in every language.
