"""Writes the rounding fixtures: qti-round-to and qti-equal-rounded as Python's decimal module computes them.

The decimal digits of a value are the shortest digits that identify the double, which Python's repr and ECMAScript's
Number.prototype.toString both give. Rounding decides on the digit after the last one kept and rounds half away from
zero (ROUND_HALF_UP in the decimal module), so 2.675 rounds to 2.68 in decimal places although the double is below it.
"""

import json
import random
from decimal import ROUND_HALF_UP, Decimal, localcontext
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "packages" / "olah" / "test" / "fixtures" / "rounding.json"
SEED = 20260102
ROUND_TO_CASES = 600
EQUAL_ROUNDED_CASES = 200
MAX_DECIMAL_PLACES = 8
MAX_SIGNIFICANT_FIGURES = 10
# Values on, or next to, a rounding boundary, and the extremes of the double range.
EDGES = [
    "0", "0.5", "-0.5", "1.5", "-1.5", "2.5", "-2.5", "2.675", "1.005", "0.045", "999.5", "9.995", "0.0005",
    "99999.5", "0.1", "0.15", "0.25", "0.35", "1e-7", "123456789.5", "1e21", "1.7976931348623157e308", "5e-324",
]


def decimal_of(value):
    return Decimal(repr(value))


def rounded(value, mode, figures):
    """Rounds a double's decimal digits to decimal places or significant figures, and returns plain decimal notation."""
    number = decimal_of(value)
    if number == 0:
        return "0"
    with localcontext() as context:
        context.prec = 1000
        exponent = -figures if mode == "decimalPlaces" else number.adjusted() - (figures - 1)
        result = number.quantize(Decimal(1).scaleb(exponent), rounding=ROUND_HALF_UP)
    return format(result.normalize(), "f")


def random_value(generator):
    if generator.random() < 0.15:
        return float(generator.choice(EDGES))
    digits = "".join(generator.choice("0123456789") for _ in range(generator.randint(1, 9)))
    sign = generator.choice(["", "-"])
    return float(f"{sign}{digits[0]}.{digits[1:] or '0'}e{generator.randint(-8, 12)}")


def random_rounding(generator):
    if generator.random() < 0.5:
        return "decimalPlaces", generator.randint(0, MAX_DECIMAL_PLACES)
    return "significantFigures", generator.randint(1, MAX_SIGNIFICANT_FIGURES)


def main():
    generator = random.Random(SEED)
    round_to = []
    for _ in range(ROUND_TO_CASES):
        value = random_value(generator)
        mode, figures = random_rounding(generator)
        round_to.append({"value": value, "mode": mode, "figures": figures, "expected": rounded(value, mode, figures)})
    equal_rounded = []
    for _ in range(EQUAL_ROUNDED_CASES):
        a = random_value(generator)
        # Half of the pairs are neighbors, so that rounding decides whether they are equal.
        b = a * (1 + generator.choice([-1, 1]) * 10 ** -generator.randint(2, 9)) if generator.random() < 0.5 else random_value(generator)
        mode, figures = random_rounding(generator)
        expected = Decimal(rounded(a, mode, figures)) == Decimal(rounded(b, mode, figures))
        equal_rounded.append({"a": a, "b": b, "mode": mode, "figures": figures, "expected": expected})
    fixture = {"generator": "validation/rounding.py", "roundTo": round_to, "equalRounded": equal_rounded}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixture, indent=1) + "\n")
    print(f"Wrote {OUTPUT.relative_to(OUTPUT.parents[4])}: {len(round_to)} round-to and {len(equal_rounded)} equal-rounded cases.")


if __name__ == "__main__":
    main()
