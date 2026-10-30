# validation

Python scripts that write the reference fixtures in `packages/olah/test/fixtures/`. They use the standard library of
Python 3.12 or later and need no packages. Run them from the repository root:

```bash
python3 validation/printf.py    # printed variables: C-style conversions as Python's % operator formats them
python3 validation/rounding.py  # qti-round-to and qti-equal-rounded as Python's decimal module computes them
```

Both write the same files every time they run: random samples use a fixed seed. Commit regenerated fixtures; CI runs only
the TypeScript tests. The oracles, the cases the scripts leave out and why are in
[evidence.md](../packages/olah/docs/evidence.md).
