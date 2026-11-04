"""Writes the scoring fixture: items of keys that QTI's own expressions score, with responses and their scores.

Each item holds one to four responses of the kinds `choice`, `choice-mapping`, `choice-marking`, `pairs`, `order`, `areas`
with `mapping` and a plain `number`, each with a random scheme, points, weight and limits, and the options `floor` and
`allParts`. The score of each response is computed here from the rules of the scoring guide (docs/runtime/scoring.md), in
exact fractions, independently of the TypeScript and of QTI: the share of the key's own maximum, scaled to `maxPoints` and
times `weight`; then the item's total, all parts and the floor, and the values of FEEDBACK. A plain number follows QTI's
`qti-equal`, whose ranges are defined in doubles, as Python's floats compute them; its responses keep away from the bounds.

Run from the repository root:

    python3 -I validation/scoring.py
"""

import json
import random
from fractions import Fraction
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "packages" / "runtime" / "test" / "fixtures" / "scoring-schemes.json"
SEED = 20261104
ITEMS = 600
FULL = 1 - 1e-12

rng = random.Random(SEED)


def exact(value):
    """A double read from its shortest decimal form, as the runtime reads a key's number."""
    return Fraction(repr(float(value)))


def single(base_type, value):
    return {"cardinality": "single", "baseType": base_type, "value": value}


def container(cardinality, base_type, values):
    return {"cardinality": cardinality, "baseType": base_type, "values": values} if values else None


def best_sum(values, count):
    return sum(sorted((exact(v) for v in values if v > 0), reverse=True)[:count], Fraction(0))


# Each kind: a generator of a key and its responses, and the key's points for a response, its maximum and its minimum.


def choice_case():
    keys = rng.sample(["A", "B", "C", "D", "E", "F"], rng.randint(1, 3))
    options = keys + [o for o in ["G", "H", "I", "J"] if rng.random() < 0.7]
    scheme = rng.choice(["all-or-nothing", "partial", "per-key"])
    key = {"kind": "choice", "keys": keys, "scheme": scheme}
    max_choices = len(keys)
    if scheme != "all-or-nothing" and rng.random() < 0.5:
        max_choices = rng.randint(1, len(options))
        key["maxChoices"] = max_choices
    cardinality = "single" if max_choices == 1 else "multiple"

    def respond():
        roll = rng.random()
        chosen = [] if roll < 0.15 else keys[:max_choices] if roll < 0.35 else rng.sample(options, rng.randint(1, min(max_choices, len(options))))
        if not chosen:
            return None
        return single("identifier", chosen[0]) if cardinality == "single" else container("multiple", "identifier", chosen)

    maximum = Fraction(1) if scheme == "all-or-nothing" else Fraction(min(len(keys), max_choices))

    def points(value):
        chosen = [] if value is None else [value["value"]] if "value" in value else value["values"]
        right = len(set(chosen) & set(keys))
        other = len(set(chosen) - set(keys))
        if scheme == "all-or-nothing":
            return Fraction(1 if set(chosen) == set(keys) else 0)
        if scheme == "partial":
            return max(Fraction(0), Fraction(right - other))
        return Fraction(right)

    return key, respond, points, maximum, Fraction(0)


def choice_mapping_case():
    options = rng.sample(["A", "B", "C", "D", "E", "F"], rng.randint(2, 5))
    values = [rng.choice([-1, 0, 0.5, 1, 2, 3, 0.1, 0.2]) for _ in options]
    if all(v <= 0 for v in values):
        values[0] = 1
    max_choices = rng.choice([1, 1, 2, 3])
    key = {"kind": "choice-mapping", "points": dict(zip(options, values))}
    if max_choices != 1:
        key["maxChoices"] = max_choices
    extra = options + ["Z"]

    def respond():
        if rng.random() < 0.15:
            return None
        chosen = rng.sample(extra, rng.randint(1, min(max_choices, len(extra))))
        return single("identifier", chosen[0]) if max_choices == 1 else container("multiple", "identifier", chosen)

    maximum = best_sum(values, max_choices)

    def points(value):
        chosen = [] if value is None else [value["value"]] if "value" in value else value["values"]
        total = sum((exact(key["points"].get(c, 0)) for c in set(chosen)), Fraction(0))
        return min(max(Fraction(0), total), maximum)

    return key, respond, points, maximum, Fraction(0)


def choice_marking_case():
    keys = rng.sample(["A", "B", "C", "D"], rng.randint(1, 2))
    options = keys + ["E", "F", "G"]
    correct = rng.choice([1, 4, 0.25, 3])
    wrong = rng.choice([-1, -0.25, 0, -2])
    blank = rng.choice([0, 0, 0.5])
    key = {"kind": "choice-marking", "keys": keys, "correct": correct, "wrong": wrong}
    if blank != 0:
        key["blank"] = blank
    max_choices = len(keys)
    cardinality = "single" if max_choices == 1 else "multiple"

    def respond():
        if rng.random() < 0.2:
            return None
        chosen = rng.sample(options, rng.randint(1, max_choices))
        return single("identifier", chosen[0]) if cardinality == "single" else container("multiple", "identifier", chosen)

    def points(value):
        if value is None:
            return exact(blank)
        chosen = [value["value"]] if "value" in value else value["values"]
        return sum((exact(correct) if c in keys else exact(wrong) for c in set(chosen)), Fraction(0))

    maximum = exact(correct) * len(keys)
    minimum = min(exact(blank), exact(wrong) * max_choices if wrong < 0 else Fraction(0))
    return key, respond, points, maximum, minimum


def pairs_case():
    sources = ["S1", "S2", "S3", "S4"][: rng.randint(2, 4)]
    targets = ["T1", "T2", "T3", "T4", "T5"]
    directed = rng.random() < 0.7
    reuse = rng.random() < 0.3
    chosen_targets = [rng.choice(targets) for _ in sources] if reuse else rng.sample(targets, len(sources))
    pairs = [[s, t] for s, t in zip(sources, chosen_targets)]
    scheme = rng.choice(["all-or-nothing", "per-pair", "mapping"])
    key = {"kind": "pairs", "pairs": pairs, "scheme": scheme}
    if not directed:
        key["directed"] = False
    if reuse:
        key["reuse"] = True
    values = [rng.choice([0.5, 1, 2, 1.5]) for _ in pairs] if scheme == "mapping" else [1 for _ in pairs]
    if scheme == "mapping":
        key["points"] = values
    max_pairs = len(pairs)
    if scheme != "all-or-nothing" and rng.random() < 0.4:
        max_pairs = len(pairs) + rng.randint(1, 3)
        key["maxPairs"] = max_pairs
    surplus = 0
    if scheme != "all-or-nothing" and rng.random() < 0.4:
        surplus = rng.choice([0.5, 1, 0.25])
        key["surplus"] = surplus
    base_type = "directedPair" if directed else "pair"
    same = (lambda p: tuple(p)) if directed else (lambda p: frozenset(p))
    key_pairs = {same(p): exact(v) for p, v in zip(pairs, values)}

    def respond():
        roll = rng.random()
        if roll < 0.15:
            return None
        if roll < 0.35:
            made = [list(p) for p in pairs]
        else:
            every = [[s, t] for s in sources for t in targets]
            made = rng.sample(every, rng.randint(1, max_pairs))
        if not directed:
            made = [p if rng.random() < 0.5 else [p[1], p[0]] for p in made]
        return container("multiple", base_type, made)

    if scheme == "all-or-nothing":
        maximum = Fraction(1)
    else:
        maximum = best_sum(values, max_pairs)

    def points(value):
        made = [] if value is None else value["values"]
        made_set = {same(p) for p in made}
        if scheme == "all-or-nothing":
            return Fraction(1 if made_set == set(key_pairs) else 0)
        if value is None:
            return Fraction(0)
        mapped = min(max(Fraction(0), sum((key_pairs.get(p, Fraction(0)) for p in made_set), Fraction(0))), maximum)
        penalty = exact(surplus) * max(0, len(made) - len(pairs))
        return max(Fraction(0), mapped - penalty)

    return key, respond, points, maximum, Fraction(0)


def order_case():
    order = rng.sample(["O1", "O2", "O3", "O4", "O5", "O6"], rng.randint(2, 6))
    scheme = rng.choice(["all-or-nothing", "per-position", "adjacent-pairs"])
    key = {"kind": "order", "order": order, "scheme": scheme}

    def respond():
        roll = rng.random()
        if roll < 0.1:
            return None
        if roll < 0.3:
            return container("ordered", "identifier", list(order))
        shuffled = rng.sample(order, len(order))
        if rng.random() < 0.2:
            shuffled = shuffled[: rng.randint(1, len(order))]
        return container("ordered", "identifier", shuffled)

    maximum = {"all-or-nothing": 1, "per-position": len(order), "adjacent-pairs": len(order) - 1}[scheme]

    def points(value):
        given = [] if value is None else value["values"]
        if scheme == "all-or-nothing":
            return Fraction(1 if given == order else 0)
        if scheme == "per-position":
            return Fraction(sum(1 for at, choice in enumerate(order) if at < len(given) and given[at] == choice))
        neighbors = set(zip(given, given[1:]))
        return Fraction(sum(1 for pair in zip(order, order[1:]) if pair in neighbors))

    return key, respond, points, Fraction(maximum), Fraction(0)


def inside(area, x, y):
    """Whether a point lies strictly inside an area, or None when it lies within 1e-6 of its edge."""
    shape, c = area["shape"], area["coords"]
    if shape == "rect":
        left, top, right, bottom = c
        near = min(abs(x - left), abs(x - right), abs(y - top), abs(y - bottom))
        if near < 1e-6 and left - 1e-6 <= x <= right + 1e-6 and top - 1e-6 <= y <= bottom + 1e-6:
            return None
        return left < x < right and top < y < bottom
    if shape == "circle":
        cx, cy, r = c
        d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
        if abs(d - r) < 1e-6:
            return None
        return d < r
    corners = list(zip(c[0::2], c[1::2]))
    signs = []
    for (x1, y1), (x2, y2) in zip(corners, corners[1:] + corners[:1]):
        cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)
        if abs(cross) < 1e-6:
            return None
        signs.append(cross > 0)
    return all(signs) or not any(signs)


def areas_case():
    areas = []
    for at in range(rng.randint(1, 4)):
        shape = rng.choice(["rect", "circle", "poly"])
        x, y = rng.randint(0, 60), rng.randint(0, 60)
        if shape == "rect":
            coords = [x, y, x + rng.randint(5, 40), y + rng.randint(5, 40)]
        elif shape == "circle":
            coords = [x + 20, y + 20, rng.randint(5, 20)]
        else:
            coords = [x, y, x + rng.randint(10, 40), y, x + rng.randint(0, 20), y + rng.randint(10, 40)]
        areas.append({"id": f"R{at}", "shape": shape, "coords": coords, "points": rng.choice([1, 1, 2, 0.5, 0])})
    if all(a["points"] == 0 for a in areas):
        areas[0]["points"] = 1
    select = rng.randint(1, len(areas))
    key = {"kind": "areas", "scheme": "mapping", "areas": areas}
    if select != len(areas) or rng.random() < 0.5:
        key["select"] = select
    maximum = best_sum([a["points"] for a in areas], select)

    def respond():
        if rng.random() < 0.15:
            return None
        made = []
        wanted = rng.randint(1, select)
        while len(made) < wanted:
            # A point of QTI is a pair of integers; one on an edge is left to the tests of the edges.
            x, y = rng.randint(0, 110), rng.randint(0, 110)
            if [x, y] in made or any(inside(a, x, y) is None for a in areas):
                continue
            made.append([x, y])
        return container("multiple", "point", made)

    def points(value):
        # Each point counts for the first area that holds it, and each area counts once (QTI's qti-map-response-point).
        made = [] if value is None else value["values"]
        hit = []
        for x, y in made:
            first = next((at for at, area in enumerate(areas) if inside(area, x, y)), None)
            if first is not None and first not in hit:
                hit.append(first)
        return min(max(Fraction(0), sum((exact(areas[at]["points"]) for at in hit), Fraction(0))), maximum)

    return key, respond, points, maximum, Fraction(0)


def number_case():
    value = round(rng.uniform(-50, 50), rng.choice([0, 1, 2]))
    key = {"kind": "number", "value": value}
    mode = rng.choice(["exact", "absolute", "relative", "both"])
    absolute = rng.choice([0.1, 0.5, 1]) if mode in ("absolute", "both") else None
    relative = rng.choice([0.01, 0.05, 0.1]) if mode in ("relative", "both") else None
    tolerance = {}
    if absolute is not None:
        tolerance["absolute"] = absolute
    if relative is not None:
        tolerance["relative"] = relative
    if tolerance:
        key["tolerance"] = tolerance
    ranges = []
    if absolute is not None:
        ranges.append((value - absolute, value + absolute))
    if relative is not None:
        mantissa, _, exponent = repr(relative).partition("e")
        percent = float(f"{mantissa}e{int(exponent or 0) + 2}")
        ends = (value * (1 - percent / 100), value * (1 + percent / 100))
        ranges.append((min(ends), max(ends)))

    def right(x):
        return x == value if not ranges else any(low <= x <= high for low, high in ranges)

    def respond():
        roll = rng.random()
        if roll < 0.15:
            return None
        if roll < 0.35:
            return single("float", value)
        while True:
            x = round(value + rng.uniform(-3, 3), 4)
            if all(abs(x - bound) > 1e-6 for low, high in ranges for bound in (low, high)):
                return single("float", x)

    def points(given):
        return Fraction(0) if given is None else Fraction(1 if right(given["value"]) else 0)

    return key, respond, points, Fraction(1), Fraction(0)


KINDS = [choice_case, choice_mapping_case, choice_marking_case, pairs_case, order_case, areas_case, number_case]


def item_case(number):
    count = rng.choice([1, 1, 2, 3, 4])
    responses, answers, parts = [], {}, []
    for at in range(count):
        key, respond, points, maximum, minimum = rng.choice(KINDS)()
        identifier = f"R{at + 1}"
        response = {"identifier": identifier, "key": key}
        max_points = rng.choice([None, None, 1, 2, 0.5, 3])
        weight = rng.choice([None, None, 2, 0.5])
        if max_points is not None:
            response["maxPoints"] = max_points
        if weight is not None:
            response["weight"] = weight
        value = respond()
        raw = points(value)
        target = (exact(max_points) if max_points is not None else maximum) * (exact(weight) if weight is not None else 1)
        scaled = raw * target / maximum
        responses.append(response)
        answers[identifier] = value
        parts.append({"identifier": identifier, "points": scaled, "maximum": target, "minimum": minimum * target / maximum, "blank": value is None})
    total = sum((p["points"] for p in parts), Fraction(0))
    maximum = sum((p["maximum"] for p in parts), Fraction(0))
    options = {}
    if rng.random() < 0.25:
        options["allParts"] = True
        total = maximum if all(p["points"] >= p["maximum"] for p in parts) else Fraction(0)
    if rng.random() < 0.25:
        floor = rng.choice([0, -1, 1]) if maximum >= 1 else 0
        options["floor"] = floor
        total = max(exact(floor), total)
    feedback = []
    for p in parts:
        verdict = "blank" if p["blank"] else "correct" if p["points"] >= p["maximum"] else "partial" if p["points"] > 0 else "incorrect"
        feedback.append(f"{p['identifier']}-{verdict}")
    return {
        "item": number,
        "responses": responses,
        "options": options,
        "answers": answers,
        "score": float(total),
        "maxScore": float(maximum),
        "parts": {p["identifier"]: float(p["points"]) for p in parts} if count > 1 else {},
        "feedback": sorted(feedback),
    }


def main():
    cases = [item_case(number) for number in range(ITEMS)]
    fixture = {"generator": "validation/scoring.py", "seed": SEED, "cases": cases}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixture, indent=1) + "\n")
    print(f"Wrote {OUTPUT.relative_to(OUTPUT.parents[4])}: {len(cases)} items.")


if __name__ == "__main__":
    main()
