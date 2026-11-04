import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Whether a folder is the root of a git clone or of a linked worktree, which have a `.git` folder or a `.git` file. */
export function isGitCheckout(root: string): boolean {
  return existsSync(join(root, ".git"));
}

/**
 * The `prepare` step of `pnpm install`: installs the git hooks in a clone and does nothing in a copy of the repository, such as
 * the one that a container works from, where `lefthook install` would fail. It runs in Node.js and not in a shell, so that it
 * works the same in `cmd.exe` and in a POSIX shell.
 *
 * @param root - The repository.
 * @param install - Installs the hooks and returns its exit code.
 * @returns The exit code.
 */
export function prepare(root: string, install: () => number): number {
  if (!isGitCheckout(root)) {
    console.log("Not a git clone: the git hooks are not installed.");
    return 0;
  }
  return install();
}

/**
 * Runs `lefthook install` in the repository. A shell finds the `lefthook.cmd` that pnpm puts on the path of Windows, and the
 * command is a fixed text, so that no argument is joined into it.
 */
function installHooks(root: string): number {
  return spawnSync("lefthook install", { cwd: root, stdio: "inherit", shell: true }).status ?? 1;
}

if (import.meta.main) {
  const root = resolve(dirname(import.meta.dirname));
  process.exitCode = prepare(root, () => installHooks(root));
}
