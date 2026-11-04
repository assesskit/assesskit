"""Writes the fixture of Moodle's readings: what Moodle 5.3 itself makes of the files that the writers of item-formats write.

The cases come from packages/runtime/test/item-formats-cases.ts: QTI items that writeGift writes, and edge cases of the formats
typed as Moodle's documentation describes them. Moodle runs in containers, imports each file with its own importer, grades the
responses of each case with each question's own grade_response, and exports each question with its own GIFT and XML exporters
(validation/moodle/questions.php). The fixture holds the cases and Moodle's results; the tests compare the readers and the
runtime's scores with them.

    python3 validation/moodle.py [--cache <folder>]

The source of Moodle is fetched at its pinned commit into the cache, which must lie where Docker can mount it, with its PHP
packages; the containers, their network and their volumes are removed whatever happens.
"""

import argparse
import json
import os
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent / "moodle"
FIXTURE = ROOT / "packages" / "runtime" / "test" / "fixtures" / "item-formats-moodle.json"
CASES = ROOT / "packages" / "runtime" / "test" / "item-formats-cases.ts"
# The commit of the tag v5.3.0 of Moodle (released 2026-10-03), as interopkit's validation pins it.
MOODLE_COMMIT = "42622298fe06f9626d988d60b2bf589bd8f850e8"
MOODLE_VERSION = "5.3.0"
COMPOSER = "composer:2@sha256:4ed71c38c6d788eb4e4e3747b5332f5b40d5b5a6fcadd5062a1a70986a118e0a"
# The entry that prints the cases as JSON, bundled with the sources by esbuild.
ENTRY = (
    'import { buildMoodleCases } from "./packages/runtime/test/item-formats-cases.ts";\n'
    "process.stdout.write(JSON.stringify(buildMoodleCases()));\n"
)


def run(command, env=None, capture=False, stdin=None):
    """Runs a command and stops the script with its output when it fails."""
    result = subprocess.run(
        command,
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        input=stdin,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.exit(f"{' '.join(command)} exited with {result.returncode}:\n{result.stdout}\n{result.stderr}")
    return result.stdout if capture else None


def prepare_source(cache):
    """Fetches the source of Moodle at the pinned commit and installs its PHP packages, unless the cache holds them."""
    source = cache / MOODLE_COMMIT
    if (source / "vendor" / "autoload.php").exists():
        return source
    shutil.rmtree(source, ignore_errors=True)
    source.mkdir(parents=True)
    run(["git", "-C", str(source), "init", "--quiet"])
    run(["git", "-C", str(source), "remote", "add", "origin", "https://github.com/moodle/moodle"])
    run(["git", "-C", str(source), "fetch", "--quiet", "--depth", "1", "origin", MOODLE_COMMIT])
    run(["git", "-C", str(source), "checkout", "--quiet", "--detach", "FETCH_HEAD"])
    head = run(["git", "-C", str(source), "rev-parse", "HEAD"], capture=True).strip()
    if head != MOODLE_COMMIT:
        sys.exit(f"The source of Moodle is at {head}, not at {MOODLE_COMMIT}.")
    run(
        ["docker", "run", "--rm", "--cpus=2", "--volume", f"{source}:/app", "--workdir", "/app", COMPOSER]
        + ["install", "--no-dev", "--no-interaction", "--no-progress", "--prefer-dist", "--ignore-platform-reqs"]
    )
    return source


def build_cases():
    """Returns the cases: the bundled test module prints them."""
    bundle = run(
        ["pnpm", "exec", "esbuild", "--bundle", "--platform=node", "--format=esm", "--log-level=warning", "--loader=ts"]
        + ["--sourcefile=cases-entry.ts"],
        capture=True,
        stdin=ENTRY,
    )
    return json.loads(run(["node", "--input-type=module"], capture=True, stdin=bundle))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache" / "moodle")
    arguments = parser.parse_args()
    cache = arguments.cache.resolve()
    source = prepare_source(cache)
    shutil.copy(HERE / "config.php", source / "config.php")
    cases = build_cases()
    project = os.environ.get("COMPOSE_PROJECT_NAME") or f"assesskit-moodle-{secrets.token_hex(4)}"
    folder = cache / f"run-{project}"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "cases.json").write_text(json.dumps(cases), encoding="utf-8")
    env = {
        "COMPOSE_PROJECT_NAME": project,
        "MOODLE_DB_ROOT_PASSWORD": secrets.token_hex(18),
        "MOODLE_DB_PASSWORD": secrets.token_hex(18),
        "MOODLE_SOURCE": str(source),
        "MOODLE_RUN": str(folder),
    }
    compose = ["docker", "compose", "--file", str(HERE / "compose.yaml")]
    in_web = compose + ["exec", "-T", "-u", "www-data", "web"]
    try:
        run(compose + ["up", "--detach", "--wait"], env)
        run(
            in_web
            + ["php", "admin/cli/install_database.php", "--lang=en", "--adminuser=admin"]
            + [f"--adminpass=Admin-{secrets.token_hex(12)}!", "--adminemail=admin@example.org"]
            + ["--fullname=Assesskit Moodle", "--shortname=ak", "--agree-license"],
            env,
        )
        run(in_web + ["php", "/opt/questions.php", "/opt/run/cases.json", "/opt/run/moodle.json"], env)
        results = json.loads((folder / "moodle.json").read_text(encoding="utf-8"))
    finally:
        subprocess.run(compose + ["down", "--volumes", "--remove-orphans"], cwd=ROOT, env={**os.environ, **env})
        shutil.rmtree(folder, ignore_errors=True)
    fixture = {
        "moodle": {"version": MOODLE_VERSION, "commit": MOODLE_COMMIT},
        "cases": [
            {**case, "moodle": result}
            for case, result in zip(cases["cases"], results["cases"], strict=True)
        ],
    }
    FIXTURE.write_text(json.dumps(fixture, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
