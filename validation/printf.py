"""Writes the printed-variable fixtures: values formatted by C-style conversions, as Python's % operator prints them.

Python's % operator and C's printf differ in a few cases, which the script leaves out: the alternate form of o
(Python writes 0o), the alternate form and precision 0 of the integer conversions at the value 0, and the 0 flag
together with a precision on an integer conversion (C ignores the flag, Python does not). The conversions o, x and X
are unsigned in C, which prints neither a sign flag nor a negative value as Python does, so the script leaves out the
flags + and space for them, and negative values.
"""

import json
import random
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "packages" / "olah" / "test" / "fixtures" / "printf.json"
SEED = 20260101
FLAGS = ["", "-", "+", " ", "#", "0", "+0", "-+"]
WIDTHS = [None, 1, 6, 12]
PRECISIONS = [None, 0, 1, 3, 6]
FLOAT_CONVERSIONS = ["e", "E", "f", "g", "G"]
INTEGER_CONVERSIONS = ["d", "i", "o", "x", "X"]
CASES_PER_FLAGS = 25
FLOATS = [
    0.0, -0.0, 1.0, -1.0, 0.5, -0.5, 1.5, 2.5, 0.1, 0.1 + 0.2, 1 / 3, 2 / 3, 123.456, -123.456, 3.14159265358979,
    1e-5, 1.5e-7, 123456.789, 1e10, 1.5e15, 1e21, 1e22, -9.99e25, 0.000123456, 99999.5, 999999.5, 1e100,
    1.7976931348623157e308, 5e-324, 2.2250738585072014e-308, 100.0, 1234567.0,
]
INTEGERS = [0, 1, -1, 7, 8, 9, 10, 15, 16, 255, -255, 4096, 123456, -123456, 2**31 - 1, -(2**31), 2**53 - 1, -(2**53 - 1)]


def cases_of(conversions, values, allowed):
    """Returns the cases of a family of conversions: a sample of widths, precisions and values for every flag set."""
    generator = random.Random(SEED)
    cases = []
    for conversion in conversions:
        for flags in FLAGS:
            candidates = [
                (width, precision, value)
                for width in WIDTHS
                for precision in PRECISIONS
                for value in values
                if allowed(conversion, flags, precision, value)
            ]
            for width, precision, value in generator.sample(candidates, min(CASES_PER_FLAGS, len(candidates))):
                specification = "%" + flags + (str(width) if width else "") + ("" if precision is None else f".{precision}")
                cases.append({"format": specification + conversion, "value": value, "expected": (specification + conversion) % value})
    return cases


def float_allowed(conversion, flags, precision, value):
    return True


def integer_allowed(conversion, flags, precision, value):
    unsigned = conversion in "oxX"
    if unsigned and value < 0:
        return False
    if unsigned and ("+" in flags or " " in flags):
        return False
    if unsigned and "#" in flags and (conversion == "o" or value == 0):
        return False
    if precision is not None and value == 0 and (precision == 0 or "#" in flags):
        return False
    return not (precision is not None and "0" in flags)


def main():
    fixture = {
        "generator": "validation/printf.py",
        "floats": cases_of(FLOAT_CONVERSIONS, FLOATS, float_allowed),
        "integers": cases_of(INTEGER_CONVERSIONS, INTEGERS, integer_allowed),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixture, indent=1) + "\n")
    print(f"Wrote {OUTPUT.relative_to(OUTPUT.parents[4])}: {len(fixture['floats'])} float and {len(fixture['integers'])} integer cases.")


if __name__ == "__main__":
    main()
