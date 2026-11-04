import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isGitCheckout, prepare } from "../prepare.ts";

const folders: string[] = [];

/** A folder of its own, with the entries given: a name that ends with `/` is a folder, any other a file. */
function folder(...entries: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "assesskit-prepare-"));
  folders.push(root);
  for (const entry of entries) {
    if (entry.endsWith("/")) mkdirSync(join(root, entry));
    else writeFileSync(join(root, entry), "gitdir: ../elsewhere\n");
  }
  return root;
}

afterEach(() => {
  for (const root of folders.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("the prepare step", () => {
  it("installs the hooks in a clone, whose .git is a folder", () => {
    const install = vi.fn(() => 0);
    expect(prepare(folder(".git/"), install)).toBe(0);
    expect(install).toHaveBeenCalledOnce();
  });

  it("installs the hooks in a linked worktree, whose .git is a file", () => {
    const install = vi.fn(() => 0);
    expect(prepare(folder(".git"), install)).toBe(0);
    expect(install).toHaveBeenCalledOnce();
  });

  it("does nothing in a copy of the repository, and succeeds", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const install = vi.fn(() => 1);
    expect(prepare(folder(), install)).toBe(0);
    expect(install).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Not a git clone: the git hooks are not installed.");
  });

  it("fails when the hooks cannot be installed in a clone", () => {
    expect(prepare(folder(".git/"), () => 3)).toBe(3);
  });

  it("tells a clone from a copy", () => {
    expect(isGitCheckout(folder(".git/"))).toBe(true);
    expect(isGitCheckout(folder("README.md"))).toBe(false);
  });
});
