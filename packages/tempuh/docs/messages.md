# Messages

The interface text is a catalog of plain strings, one per function of the interface, so that the same function has the
same name everywhere (WCAG 3.2.4). tempuh ships English and Indonesian.

| Key                      | English              | Indonesian              |
| ------------------------ | -------------------- | ----------------------- |
| `interactiveQuestion`    | Interactive question | Soal interaktif         |
| `toolRule`               | Ruler                | Penggaris               |
| `toolProtractor`         | Protractor           | Busur derajat           |
| `toolLineReader`         | Line reader          | Penyorot baris          |
| `toolAnswerMasking`      | Answer masking       | Penutup pilihan jawaban |
| `toolBasicCalculator`    | Basic calculator     | Kalkulator dasar        |
| `toolStandardCalculator` | Standard calculator  | Kalkulator standar      |

`Messages` is the type of a catalog, `EN_MESSAGES` and `ID_MESSAGES` are the shipped ones, and a catalog for another
language has the same keys.

## Choosing a catalog

`selectMessages(language, overrides)` returns the messages for the language of the interface.

| Parameter   | Type                                | Meaning                                                                                                    |
| ----------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `language`  | `string`                            | A BCP 47 tag, such as `id` or `id-ID`. Case is ignored.                                                    |
| `overrides` | `Record<string, Partial<Messages>>` | Messages that replace the shipped ones, by language tag; a catalog may have only some keys. Default: `{}`. |

The result starts as the English messages. The shipped catalog of the language replaces them, then the overrides for the
language, then the overrides for the tag in full. A language without a catalog gets English, so every key has a message.

```ts
import { selectMessages } from "@luthfanwakan/tempuh";

selectMessages("id-ID").toolRule; // "Penggaris"
selectMessages("jv").toolRule; // "Ruler"
selectMessages("id", { id: { toolRule: "Mistar" } }).toolRule; // "Mistar"
```

`selectMessages` throws `DataError` when `language` is not a string, `overrides` is not an object of objects, a catalog
has a key that is not a message key, or a message is not a string.

## Adding a message

A message is a property of `Messages` with a TSDoc comment, and a string in both `en.ts` and `id.ts`; the type checker
refuses a catalog that lacks one. Its text names a function of the interface, never a shape, color or position alone
(WCAG 1.3.3), and no two keys of a catalog have the same text.
