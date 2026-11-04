"""Writes the reference shares of `number-equivalent` from Python's `fractions` and `decimal`.

Keys with tolerances, units, fractions, significant figures, credit tiers, intervals and components, and responses written
every way the reading rules take, and ways they refuse: a sign, digits with one decimal mark of either separator, `a/b` and
`a b/c`, a power of ten as `e` and `n`, `\\times10^{n}` or `×10^n`, a unit after the number, group separators, a power past
400. The share is computed here in exact rationals, by the rules of the guide, independently of the TypeScript.

Run from the repository root, in a venv from `validation/operators/requirements.txt`:

    python -I validation/operators/numbers.py packages/runtime/test/fixtures/operators-numbers.json
"""

import json
import platform
import random
import re
import sys
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction

SEED = 20261104
MAX_EXPONENT = 400
WHITE_SPACE = "[\\t-\\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]"

rng = random.Random(SEED)


def exact(value):
    """A double read from its shortest decimal form, as `String(value)` writes it: 1.1 is 11/10."""
    return Fraction(repr(float(value)))


def significant_digits(whole, fraction):
    digits = (whole + (fraction or "")).lstrip("0")
    return len(digits) if fraction is not None else len(digits.rstrip("0"))


def read_number(text, separator, fractions):
    """The value, the significant digits shown and the unit of a response, or None when it does not read."""
    text = re.sub(f"^{WHITE_SPACE}+|{WHITE_SPACE}+$", "", text)
    sign = 1
    if text[:1] in ("-", "−"):
        sign, text = -1, text[1:]
    elif text[:1] == "+":
        text = text[1:]
    value = significant = None
    length = 0
    if fractions:
        mixed = re.match(f"(\\d+){WHITE_SPACE}+(\\d+){WHITE_SPACE}*/{WHITE_SPACE}*(\\d+)", text)
        simple = mixed or re.match(f"(\\d+){WHITE_SPACE}*/{WHITE_SPACE}*(\\d+)", text)
        if simple:
            whole, numerator, denominator = mixed.groups() if mixed else ("0", *simple.groups())
            if int(denominator) == 0:
                return None
            value, length = Fraction(int(whole)) + Fraction(int(numerator), int(denominator)), simple.end()
    if value is None:
        mark = re.escape(separator)
        decimal = re.match(f"(?:(\\d+)(?:{mark}(\\d+))?|{mark}(\\d+))", text)
        if not decimal:
            return None
        whole = decimal.group(1) or ""
        digits = decimal.group(2) if decimal.group(2) is not None else decimal.group(3)
        rest = text[decimal.end() :]
        power = re.match("[eE]([+\\-−]?\\d+)", rest) or re.match(
            f"{WHITE_SPACE}*(?:\\\\times|×){WHITE_SPACE}*10{WHITE_SPACE}*\\^{WHITE_SPACE}*(?:\\{{{WHITE_SPACE}*([+\\-−]?\\d+){WHITE_SPACE}*\\}}|([+\\-−]?\\d+))",
            rest,
        )
        exponent = 0
        if power:
            exponent = int((power.group(1) or power.group(2)).replace("−", "-"))
            if abs(exponent) > MAX_EXPONENT:
                return None
        value = Fraction(int((whole + (digits or "")) or "0"), 10 ** len(digits or "")) * Fraction(10) ** exponent
        significant = significant_digits(whole, digits)
        length = decimal.end() + (power.end() if power else 0)
    rest = re.sub(f"^{WHITE_SPACE}+|{WHITE_SPACE}+$", "", text[length:])
    if re.match("[0-9.,'\\\\]", rest):
        return None
    return sign * value, significant, re.sub(f"{WHITE_SPACE}+", " ", rest)


def within(value, target, tolerance):
    absolute, relative = tolerance.get("absolute"), tolerance.get("relative")
    if absolute is None and relative is None:
        return value == target
    distance = abs(value - target)
    if absolute is not None and distance <= exact(absolute):
        return True
    return relative is not None and distance <= exact(relative) * abs(target)


def round_significant(value, figures):
    """Rounds a decimal to significant figures, half away from zero, with `decimal`'s ROUND_HALF_UP."""
    if value == 0:
        return Fraction(0)
    number = Decimal(value.numerator) / Decimal(value.denominator)
    quantum = Decimal(1).scaleb(number.adjusted() - figures + 1)
    return Fraction(number.quantize(quantum, rounding=ROUND_HALF_UP))


def converted(written, units):
    value, _, unit = written
    if unit == "":
        return value
    collapsed = {re.sub(f"{WHITE_SPACE}+", " ", name.strip()): factor for name, factor in units.items()}
    return value * exact(collapsed[unit]) if unit in collapsed else None


def is_right(written, value, target, key):
    figures = key.get("significantFigures")
    tolerance = key.get("tolerance", {})
    if figures is None:
        return within(value, target, tolerance)
    return written[1] == figures and within(value, round_significant(target, figures), tolerance)


def share_of(text, key):
    separator, fractions = key.get("decimalSeparator", "."), key.get("fractions", False)
    if key.get("components") is not None:
        strings = text
        if len(strings) > len(key["components"]):
            return None
        right = read = 0
        for string, component in zip(strings, key["components"]):
            written = read_number(string, separator, fractions) if string.strip() else None
            if written is None:
                continue
            read += 1
            value = converted(written, key.get("units", {}))
            if value is not None and is_right(written, value, exact(component), key):
                right += 1
        return None if read == 0 else right / len(key["components"])
    written = read_number(text, separator, fractions) if text.strip() else None
    if written is None:
        return None
    value = converted(written, key.get("units", {}))
    if value is None:
        return 0
    if key.get("intervals") is not None:
        for interval in key["intervals"]:
            low, high = interval["min"], interval["max"]
            above = low is None or (value >= exact(low) if interval.get("minIncluded", True) else value > exact(low))
            below = high is None or (value <= exact(high) if interval.get("maxIncluded", True) else value < exact(high))
            if above and below:
                return 1
        return 0
    target = exact(key["value"])
    if is_right(written, value, target, key):
        return 1
    for tier in sorted(key.get("credit", []), key=lambda tier: -tier["share"]):
        if within(value, target, tier["tolerance"]):
            return tier["share"]
    return 0


def written_forms(value, separator):
    """Ways a candidate writes a decimal value, and ways the rules refuse."""
    text = format(Decimal(str(value)).normalize(), "f")
    mark = text.replace(".", separator)
    forms = [mark, f"+{mark}", f" {mark} ", f"−{mark}" if not mark.startswith("-") else mark]
    mantissa, exponent = f"{Decimal(str(value)):.3E}".split("E")
    forms += [f"{mantissa.replace('.', separator)}e{int(exponent)}", f"{mantissa.replace('.', separator)}\\times10^{{{int(exponent)}}}"]
    forms += [f"{mantissa.replace('.', separator)} × 10^{int(exponent)}", f"{mark}e401", f"{mark}5"]
    forms += ["1,000" if separator == "." else "1.000", "1 000", "5" + separator, "- 3", "abc", "3e999"]
    return forms


def key_cases():
    cases = []
    for _ in range(160):
        whole = rng.choice([0, 1, 3, 12, 250, 1200])
        value = round(whole + rng.choice([0, 0.5, 0.25, 0.125, 0.3333, 0.1]), 4) * rng.choice([1, 1, -1])
        separator = rng.choice([".", ".", ","])
        key = {"kind": "number", "value": value, "decimalSeparator": separator}
        choice = rng.random()
        if choice < 0.2:
            key["tolerance"] = {"absolute": rng.choice([0.01, 0.1, 0.5])}
        elif choice < 0.35:
            key["tolerance"] = {"relative": rng.choice([0.01, 0.05])}
        elif choice < 0.5:
            key["significantFigures"] = rng.choice([2, 3, 4])
            if value == 0:
                key["value"] = 2.5
        elif choice < 0.6:
            key["credit"] = [{"tolerance": {"absolute": 1}, "share": 0.5}, {"tolerance": {"relative": 0.1}, "share": 0.25}]
        elif choice < 0.7:
            key["intervals"] = [{"min": value - 1, "max": value + 1, "maxIncluded": False}, {"min": None, "max": -100}]
        if rng.random() < 0.25:
            key["units"] = {"m": 1, "cm": 0.01, "k m": 1000}
        responses = written_forms(value, separator)
        responses += [written_forms(value + 0.01, separator)[0], written_forms(value * 1.05, separator)[0]]
        if "units" in key:
            responses += [f"{written_forms(value * 100, separator)[0]} cm", f"{written_forms(value, separator)[0]}m", f"{written_forms(value, separator)[0]} kg"]
        if rng.random() < 0.3:
            key["fractions"] = True
            fraction = Fraction(str(abs(value))).limit_denominator(16)
            responses += [f"{fraction.numerator}/{fraction.denominator}", f"{fraction.numerator // fraction.denominator} {fraction.numerator % fraction.denominator}/{fraction.denominator}", "1/0"]
        for response in responses:
            cases.append({"key": key, "response": response, "share": share_of(response, key)})
    return cases


def component_cases():
    cases = []
    for _ in range(30):
        components = [round(rng.uniform(-50, 50), 2) for _ in range(rng.choice([2, 3]))]
        key = {"kind": "number", "value": 0, "components": components, "tolerance": {"absolute": 0.005}}
        responses = [
            [str(component) for component in components],
            [str(component) for component in components][:-1],
            [str(components[0] + 1)] + [str(component) for component in components[1:]],
            ["abc"] + [str(component) for component in components[1:]],
            [str(component) for component in components] + ["7"],
        ]
        for response in responses:
            cases.append({"key": key, "response": response, "share": share_of(response, key)})
    return cases


def main(path):
    fixture = {
        "generator": "validation/operators/numbers.py",
        "seed": SEED,
        "python": platform.python_version(),
        "cases": key_cases() + component_cases(),
    }
    with open(path, "w", encoding="utf-8") as file:
        json.dump(fixture, file, indent=1, ensure_ascii=False)
        file.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
