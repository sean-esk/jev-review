// Git-backed source discovery for codebase scans. Honors language patterns,
// generated-path ignores, explicit file lists, and a smoke-test limit.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { SOURCE_FILE } from "../domain/config.ts";
import type { SourceFile } from "../domain/types.ts";
import { repoRootOf } from "./git.ts";
import { redactSecrets } from "./redact.ts";

export type FileDiscoveryOptions = {
  sourceFile?: RegExp;
  ignorePath?: RegExp;
  limit?: number;
  files?: string[];
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function normalizePath(path: string): string {
  return path.replace(/^\.\/+/, "").replace(/\\/g, "/");
}

function listedFiles(repoRoot: string, spec: string): string[] {
  return git(repoRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "--", spec])
    .split("\n")
    .filter(Boolean);
}

function keep(
  path: string,
  options: FileDiscoveryOptions,
  repoRoot: string,
): boolean {
  const sourceFile = options.sourceFile ?? SOURCE_FILE;
  return (
    sourceFile.test(path) &&
    (!options.ignorePath || !options.ignorePath.test(path)) &&
    existsSync(resolve(repoRoot, path))
  );
}

export function repositoryFiles(scope: string, options: FileDiscoveryOptions = {}): SourceFile[] {
  const realScope = realpathSync(scope);
  const repoRoot = repoRootOf(realScope);
  const relativeScope = relative(repoRoot, realScope) || ".";
  let paths = listedFiles(repoRoot, relativeScope);
  if (statSync(realScope).isFile()) {
    paths = [relative(repoRoot, realScope)];
  }

  if (options.files && options.files.length > 0) {
    const wanted = new Set(options.files.map(normalizePath));
    paths = paths.filter((path) => wanted.has(path) || wanted.has(path.split("/").pop() ?? ""));
  }

  paths = paths.filter((path) => keep(path, options, repoRoot));
  if (options.limit != null) paths = paths.slice(0, options.limit);

  return paths.map((path) => ({
    path,
    content: redactSecrets(readFileSync(resolve(repoRoot, path), "utf8")),
  }));
}

export function hintFiles(
  repoRoot: string,
  hints: string[],
  options: FileDiscoveryOptions = {},
): SourceFile[] {
  const seen = new Set<string>();
  const files: SourceFile[] = [];
  for (const hint of hints) {
    for (const path of listedFiles(repoRoot, hint)) {
      if (seen.has(path) || !keep(path, options, repoRoot)) continue;
      seen.add(path);
      files.push({
        path,
        content: redactSecrets(readFileSync(resolve(repoRoot, path), "utf8")),
      });
    }
  }
  return files;
}