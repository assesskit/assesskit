import { type CodePointSet, codePointSet, subtract, union } from "./code-point-set.js";

const code = (character: string): number => character.codePointAt(0) ?? 0;

/** The code points that start an XML name: `NameStartChar` of XML 1.0, fifth edition. */
export const NAME_START_CHARS: CodePointSet = codePointSet([
  [code(":"), code(":")],
  [code("A"), code("Z")],
  [code("_"), code("_")],
  [code("a"), code("z")],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x2ff],
  [0x370, 0x37d],
  [0x37f, 0x1fff],
  [0x200c, 0x200d],
  [0x2070, 0x218f],
  [0x2c00, 0x2fef],
  [0x3001, 0xd7ff],
  [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd],
  [0x10000, 0xeffff],
]);

/** The code points of an XML name: `NameChar` of XML 1.0, fifth edition. */
export const NAME_CHARS: CodePointSet = union(
  NAME_START_CHARS,
  codePointSet([
    [code("-"), code(".")],
    [code("0"), code("9")],
    [0xb7, 0xb7],
    [0x300, 0x36f],
    [0x203f, 0x2040],
  ]),
);

const COLON: CodePointSet = [[code(":"), code(":")]];

/** The code points that start an `NCName`, a name without a colon. */
export const NC_NAME_START_CHARS: CodePointSet = subtract(NAME_START_CHARS, COLON);

/** The code points of an `NCName`. */
export const NC_NAME_CHARS: CodePointSet = subtract(NAME_CHARS, COLON);
