# cspell:ignore Straße résumé λόγος
"""Writes the reference shares of `text-equivalent` from Python's `unicodedata` and an edit distance by dynamic programming.

Keys of answers with points, counts, the schemes `forms` and `words`, every normalization, credit tiers by edit distance and
length rules, against responses with fullwidth forms, ligatures, combining marks, case, other white space, slips and lengths.
The share is computed here: each answer's texts and each response string normalized by `unicodedata.normalize` and
`str.lower`, the most points that a matching of answers to strings keeps, found by trying every matching, then the credit
of the strings left and the effects of the length rule. The characters come from blocks whose normalization and case are the
same in Node's ICU and Python's `unicodedata`, Latin, Greek, Cyrillic, the Halfwidth and Fullwidth Forms and CJK.

Run from the repository root, in a venv from `validation/operators/requirements.txt`:

    python -I validation/operators/texts.py packages/runtime/test/fixtures/operators-texts.json
"""

import itertools
import json
import platform
import random
import sys
import unicodedata

SEED = 20261104
MAX_EDIT_BAND = 64
WHITE_SPACE = {*range(0x09, 0x0E), 0x20, 0x85, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000}

rng = random.Random(SEED)

DEFAULT_NORMALIZATION = {"form": "NFKC", "foldWidth": True, "ignoreMarks": False, "caseSensitive": False, "collapseWhitespace": True}


def split_white_space(text):
    words, current = [], ""
    for character in text:
        if ord(character) in WHITE_SPACE:
            if current:
                words.append(current)
            current = ""
        else:
            current += character
    return words + ([current] if current else [])


def normalize(text, normalization):
    result = unicodedata.normalize(normalization["form"], text)
    if normalization["foldWidth"]:
        result = "".join(unicodedata.normalize("NFKC", c) if 0xFF00 <= ord(c) <= 0xFFEF else c for c in result)
    if normalization["ignoreMarks"]:
        stripped = "".join(c for c in unicodedata.normalize("NFD", result) if unicodedata.category(c) != "Mn")
        result = unicodedata.normalize(normalization["form"], stripped)
    if not normalization["caseSensitive"]:
        result = result.lower()
    if normalization["collapseWhitespace"]:
        result = " ".join(split_white_space(result))
    return result


def edit_distance(first, second):
    """Levenshtein's distance in code points, by the full table of dynamic programming."""
    previous = list(range(len(second) + 1))
    for i, a in enumerate(first, 1):
        current = [i]
        for j, b in enumerate(second, 1):
            current.append(min(previous[j - 1] + (a != b), previous[j] + 1, current[j - 1] + 1))
        previous = current
    return previous[-1]


def credit_share(tiers, texts, string):
    for tier in sorted(tiers, key=lambda tier: -tier["share"]):
        absolute, relative = tier["tolerance"].get("absolute"), tier["tolerance"].get("relative")
        for text in texts:
            allowed = max(-1 if absolute is None else absolute, -1 if relative is None else relative * len(text))
            if allowed >= 0 and edit_distance(string, text) <= min(MAX_EDIT_BAND, int(allowed)):
                return tier["share"]
    return 0


def share_of(strings, key):
    normalization = {**DEFAULT_NORMALIZATION, **key.get("normalization", {})}
    if all(not s.strip() or all(ord(c) in WHITE_SPACE for c in s) for s in strings):
        return None
    normalized = [normalize(s, normalization) for s in strings]
    candidates = [w for s in normalized for w in split_white_space(s)] if key.get("scheme") == "words" else normalized
    answers = sorted(
        [
            {"texts": {normalize(t, normalization) for t in answer["texts"]}, "points": answer.get("points", 1)}
            for answer in key["answers"]
        ],
        key=lambda answer: -answer["points"],
    )
    count = key.get("count", 1)
    maximum = sum(answer["points"] for answer in answers[:count])
    # The greedy rule keeps the most points: the best matching of at most `count` answers, found by trying them all.
    best, best_kept = 0, ()
    for size in range(min(count, len(answers), len(candidates)), 0, -1):
        for chosen in itertools.combinations(range(len(answers)), size):
            for strings_used in itertools.permutations(range(len(candidates)), size):
                if all(candidates[s] in answers[a]["texts"] for a, s in zip(chosen, strings_used)):
                    points = sum(answers[a]["points"] for a in chosen)
                    if points > best:
                        best, best_kept = points, (chosen, strings_used)
    points = best
    tiers = key.get("credit", [])
    if tiers:
        kept = set(best_kept[0]) if best_kept else set()
        used = set(best_kept[1]) if best_kept else set()
        for index, candidate in enumerate(candidates):
            if index in used or len(kept) >= count:
                continue
            earned = [(credit_share(tiers, answers[a]["texts"], candidate) * answers[a]["points"], a) for a in range(len(answers)) if a not in kept]
            earned = [entry for entry in earned if entry[0] > 0]
            if earned:
                value, answer = max(earned, key=lambda entry: (entry[0], -entry[1]))
                kept.add(answer)
                points += value
    share = points / maximum
    rule = key.get("length")
    if rule is not None:
        # The texts hold no cluster but a letter and its combining marks, so a cluster is a code point that is no mark.
        clusters = lambda s: sum(1 for c in s if unicodedata.category(c) not in ("Mn", "Me"))
        length = sum(len(split_white_space(s)) if rule["unit"] == "words" else clusters(s) for s in strings)
        for effect in rule.get("effects", []):
            bound = rule.get("min") if effect["when"] == "below" else rule.get("max")
            threshold = effect.get("share", 1) * bound
            if (effect["when"] == "below" and length < threshold) or (effect["when"] == "above" and length > threshold):
                share = 0 if effect["effect"] == "zero" else max(0, share - effect["effect"]["deduct"])
    return share


VARIANTS = [
    lambda text: text,
    lambda text: text.upper(),
    lambda text: "  " + text.replace(" ", "　") + " ",
    lambda text: "".join(chr(ord(c) + 0xFEE0) if "!" <= c <= "~" else c for c in text),
    lambda text: unicodedata.normalize("NFD", text),
    lambda text: text.replace("fi", "ﬁ"),
    lambda text: text[:-1] if len(text) > 3 else text + "x",
    lambda text: text[0] + text[2] + text[1] + text[3:] if len(text) > 3 else text,
]
WORDS = ["café", "naïve", "fish", "office", "λόγος", "мир", "東京", "Straße", "résumé", "piano"]


def text_cases():
    cases = []
    for _ in range(180):
        answers = [{"texts": [rng.choice(WORDS)], "points": rng.choice([1, 1, 2])} for _ in range(rng.choice([1, 2, 3]))]
        key = {"kind": "text", "answers": answers, "count": rng.choice([1, len(answers)]), "scheme": rng.choice(["forms", "words"])}
        if rng.random() < 0.4:
            key["normalization"] = {
                "form": rng.choice(["NFC", "NFD", "NFKC", "NFKD"]),
                "foldWidth": rng.random() < 0.7,
                "ignoreMarks": rng.random() < 0.5,
                "caseSensitive": rng.random() < 0.3,
                "collapseWhitespace": rng.random() < 0.8,
            }
        if rng.random() < 0.35:
            key["credit"] = [{"tolerance": {"absolute": 1}, "share": 0.5}, {"tolerance": {"relative": 0.5}, "share": 0.25}]
        if rng.random() < 0.25:
            key["length"] = {"unit": rng.choice(["words", "characters"]), "min": 2, "max": 12, "effects": [
                {"when": "below", "effect": "zero"},
                {"when": "above", "share": 1.5, "effect": {"deduct": 0.5}},
            ]}
        for variant in VARIANTS:
            texts = [variant(answer["texts"][0]) for answer in answers]
            strings = [" ".join(texts)] if key["scheme"] == "words" else texts[: key["count"]]
            cases.append({"key": key, "response": strings, "share": share_of(strings, key)})
    return cases


def main(path):
    fixture = {
        "generator": "validation/operators/texts.py",
        "seed": SEED,
        "python": platform.python_version(),
        "unidata": unicodedata.unidata_version,
        "cases": text_cases(),
    }
    with open(path, "w", encoding="utf-8") as file:
        json.dump(fixture, file, indent=1, ensure_ascii=True)
        file.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
