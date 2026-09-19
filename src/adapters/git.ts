// Git adapter: dirty-tree diffs, or a three-dot merge-base range for LM PRs.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { SOURCE_FILE } from "../domain/config.ts";
import { patchForNewFile } from "../domain/patch.ts";
import type { ChangedFile } from "../domain/types.ts";
import { redactSecrets } from "./redact.ts";

export type ChangeDiscoveryOptions = {
  sourceFile?: RegExp;
  ignorePath?: RegExp;
  limit?: number;
  files?: string[];
  base?: string;
  mergeBaseSha?: string;
  headSha?: string;
};

export type DiffRange =
  | { kind: "worktree" }
  | { kind: "threeDot"; left: string; right: string };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function lines(output: string): string[] {
  return output.split("\n").filter(Boolean);
}

export function repoRootOf(scope: string): string {
  const realScope = realpathSync(scope);
  const cwd = statSync(realScope).isDirectory() ? realScope : resolve(realScope, "..");
  return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
}

export function hasRef(scope: string, ref: string): boolean {
  try {
    git(repoRootOf(scope), ["rev-parse", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

export function diffRange(
  options: Pick<ChangeDiscoveryOptions, "base" | "mergeBaseSha" | "headSha">,
): DiffRange {
  if (options.mergeBaseSha) {
    return { kind: "threeDot", left: options.mergeBaseSha, right: options.headSha ?? "HEAD" };
  }
  if (options.base && options.base !== "worktree") {
    return { kind: "threeDot", left: options.base, right: options.headSha ?? "HEAD" };
  }
  return { kind: "worktree" };
}

function requireRef(repoRoot: string, ref: string): void {
  try {
    git(repoRoot, ["rev-parse", "--verify", ref]);
  } catch {
    throw new Error(
      "Missing git ref " +
        ref +
        ". Fetch it (for LM: git fetch origin staging) or pass --base worktree / a SHA pair.",
    );
  }
}

function applyFilters(
  paths: string[],
  options: ChangeDiscoveryOptions,
): string[] {
  const sourceFile = options.sourceFile ?? SOURCE_FILE;
  const ignorePath = options.ignorePath;
  const wanted = options.files?.map(normalizePath);
  let next = [...new Set(paths)].filter(
    (path) => sourceFile.test(path) && (!ignorePath || !ignorePath.test(path)),
  );
  if (wanted && wanted.length > 0) {
    const set = new Set(wanted);
    next = next.filter((path) => set.has(path) || set.has(path.split("/").pop() ?? ""));
  }
  if (options.limit != null) next = next.slice(0, options.limit);
  return next;
}

function normalizePath(path: string): string {
  return path.replace(/^\.\/+/, "").replace(/\\/g, "/");
}

export function changedFiles(scope: string, options: ChangeDiscoveryOptions = {}): ChangedFile[] {
  const realScope = realpathSync(scope);
  const repoRoot = repoRootOf(realScope);
  const relativeScope = relative(repoRoot, realScope) || ".";
  const range = diffRange(options);

  let paths: string[];
  const untrackedSet = new Set<string>();

  if (range.kind === "threeDot") {
    requireRef(repoRoot, range.left);
    requireRef(repoRoot, range.right);
    paths = lines(
      git(repoRoot, [
        "diff",
        range.left + "..." + range.right,
        "--name-only",
        "--diff-filter=ACMRTUXB",
        "--",
        relativeScope,
      ]),
    );
  } else {
    const tracked = lines(
      git(repoRoot, [
        "diff",
        "HEAD",
        "--name-only",
        "--diff-filter=ACMRTUXB",
        "--",
        relativeScope,
      ]),
    );
    const untracked = lines(
      git(repoRoot, ["ls-files", "--others", "--exclude-standard", "--", relativeScope]),
    );
    for (const path of untracked) untrackedSet.add(path);
    paths = [...tracked, ...untracked];
  }

  return applyFilters(paths, options)
    .filter((path) => existsSync(resolve(repoRoot, path)))
    .map((path) => ({
      path,
      patch: redactSecrets(
        untrackedSet.has(path)
          ? patchForNewFile(readFileSync(resolve(repoRoot, path), "utf8"))
          : range.kind === "threeDot"
            ? git(repoRoot, [
                "diff",
                range.left + "..." + range.right,
                "--unified=3",
                "--",
                path,
              ])
            : git(repoRoot, ["diff", "HEAD", "--unified=3", "--", path]),
      ),
    }));
}