# validation

Python scripts that write the reference fixtures in `packages/runtime/test/fixtures/` and `packages/player/test/fixtures/`. They
use the standard library of Python 3.12 or later and need no packages. Run them from the repository root:

```bash
python3 validation/printf.py       # printed variables: C-style conversions as Python's % operator formats them
python3 validation/rounding.py     # qti-round-to and qti-equal-rounded as Python's decimal module computes them
python3 validation/zip.py          # ZIP archives that Python's zipfile writes and reads: valid, ZIP64 and hostile
python3 validation/caliper_ids.py  # Caliper identifiers: the name-based UUIDs that Python's uuid5 computes (player)
```

They write the same files every time they run: random samples use a fixed seed. Commit regenerated fixtures; CI runs only
the TypeScript tests. The oracles, the cases the scripts leave out and why are in
[evidence.md](../packages/runtime/docs/evidence.md), and for the player in [evidence.md](../packages/player/docs/evidence.md#tests-of-caliper).
