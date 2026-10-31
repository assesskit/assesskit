"""Writes the identifier fixtures of Caliper: the name-based UUIDs of version 5 that Python's uuid module computes.

The player names an identifier by the JSON text of an array of parts and hashes it in the namespace below, which is the UUID of
the address of the player's caliper folder in the URL namespace. Python's uuid5 implements RFC 9562 §5.5 independently of
the player's WebCrypto code. The fixture also holds the worked example of RFC 9562 Appendix A.4 as the script computes it.
"""

import json
import uuid
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "packages" / "player" / "test" / "fixtures" / "caliper-ids.json"
ADDRESS = "https://github.com/assesskit/assesskit/tree/main/packages/player/src/caliper"
NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, ADDRESS)
SESSION = "s-1"
ASSESSMENT = "https://exam.example/tests/42"


def name_of(parts):
    """The JSON text of the parts, as JSON.stringify writes it: no spaces, and characters kept as they are."""
    return json.dumps(parts, ensure_ascii=False, separators=(",", ":"))


def cases():
    """Every list of parts that the tests of the player look up."""
    parts = [
        ["attempt", SESSION],
        ["attempt", SESSION, "q1", 1],
        ["attempt", SESSION, "q2", 1],
        ["attempt", SESSION, "q2", 2],
        ["item", ASSESSMENT, "q1"],
        ["item", ASSESSMENT, "q2"],
        ["section", ASSESSMENT, "main"],
        # Parts that a plain join would confuse, and text that JSON escapes or leaves as it is.
        ["event", "a\nb", "start", 0],
        ["event", "a", "\nb", 0],
        ["event", "café ✓", "start", 0],
        ["event", 'a"b\\c', 7, 12],
        ["event", "1", 1, 1],
        ["event", 1, "1", 1],
    ]
    for step in ("start", *range(1, 9)):
        for index in ([-1, 0, 1, 2, 3, 4] if step == "start" else [0, 1, 2, 3, 4]):
            parts.append(["event", SESSION, step, index])
    parts.append(["score", SESSION, 7, 0])
    parts.append(["score", SESSION, 7, 1])
    return parts


def main():
    fixture = {
        "address": ADDRESS,
        "namespace": str(NAMESPACE),
        "rfc9562": {
            "namespace": str(uuid.NAMESPACE_DNS),
            "name": "www.example.com",
            "uuid": str(uuid.uuid5(uuid.NAMESPACE_DNS, "www.example.com")),
        },
        "names": [
            {"parts": parts, "name": name_of(parts), "uuid": str(uuid.uuid5(NAMESPACE, name_of(parts)))}
            for parts in cases()
        ],
    }
    OUTPUT.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(fixture['names'])} names to {OUTPUT.relative_to(OUTPUT.parents[4])}.")


if __name__ == "__main__":
    main()
