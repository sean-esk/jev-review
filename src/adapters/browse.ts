// Local folder listing for the dashboard launcher. Loopback-only; still
// skips generated trees and never reads file contents.
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { GENERATED_PATH, SOURCE_FILE_WITH_PYTHON } from "../domain/config.ts";

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  "out",
  "reviews",
]);

export type BrowseEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
};

export type BrowseListing = {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
};

export function workspaceRoot(): string {
  const configured = process.env.JEV_WORKSPACE?.trim();
  if (configured) return resolve(configured);
  const sibling = resolve(import.meta.dirname, "..", "..", "..", "LM-Apps-Monorepo");
  if (existsSync(sibling)) return sibling;
  return process.cwd();
}

export function resolveScope(input: string): { scope: string; file?: string } {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Choose a folder");
  const resolved = resolve(trimmed);
  if (!existsSync(resolved)) throw new Error("Folder not found: " + trimmed);
  const info = statSync(resolved);
  if (info.isFile()) return { scope: dirname(resolved), file: basename(resolved) };
  if (!info.isDirectory()) throw new Error("Not a folder: " + trimmed);
  return { scope: resolved };
}

export function listBrowse(path: string): BrowseListing {
  const resolved = resolve(path.trim() || workspaceRoot());
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error("Folder not found: " + path);
  }

  const parent = dirname(resolved);
  const entries: BrowseEntry[] = [];
  for (const dirent of readdirSync(resolved, { withFileTypes: true })) {
    if (dirent.name.startsWith(".") || SKIP.has(dirent.name)) continue;
    const full = resolve(resolved, dirent.name);
    if (dirent.isDirectory()) {
      if (GENERATED_PATH.test(full.replace(/\\/g, "/") + "/")) continue;
      entries.push({ name: dirent.name, path: full, kind: "dir" });
      continue;
    }
    if (dirent.isFile() && SOURCE_FILE_WITH_PYTHON.test(dirent.name)) {
      entries.push({ name: dirent.name, path: full, kind: "file" });
    }
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    path: resolved,
    parent: parent !== resolved ? parent : null,
    entries: entries.slice(0, 400),
  };
}
