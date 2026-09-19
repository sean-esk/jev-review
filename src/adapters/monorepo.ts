// Detect pnpm/npm workspace members so a codebase scan cannot swallow the repo root.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { repoRootOf } from "./git.ts";

export type MonorepoInspect = {
  repoRoot: string;
  relativeScope: string;
  shards: string[];
  isMonorepoRoot: boolean;
};

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function workspaceGlobs(repoRoot: string): string[] {
  const yaml = readText(join(repoRoot, "pnpm-workspace.yaml"));
  if (yaml) {
    return [...yaml.matchAll(/^\s*-\s*["']?([^"'\n]+)["']?\s*$/gm)].map((match) => match[1]);
  }

  const pkgText = readText(join(repoRoot, "package.json"));
  if (!pkgText) return [];
  try {
    const pkg = JSON.parse(pkgText) as {
      workspaces?: string[] | { packages?: string[] };
    };
    if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
    if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) return pkg.workspaces.packages;
  } catch {
    return [];
  }
  return [];
}

function expandGlob(repoRoot: string, glob: string): string[] {
  const cleaned = glob.replace(/\/$/, "");
  if (cleaned.endsWith("/*")) {
    const parent = join(repoRoot, cleaned.slice(0, -2));
    if (!existsSync(parent) || !statSync(parent).isDirectory()) return [];
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => normalize(relative(repoRoot, join(parent, entry.name))));
  }
  const full = join(repoRoot, cleaned);
  return existsSync(full) ? [normalize(cleaned)] : [];
}

function membersFromWorkspaceApps(repoRoot: string): string[] {
  const text = readText(join(repoRoot, "workspace-apps.json"));
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter((item) => typeof item === "string");
    if (parsed && typeof parsed === "object") {
      const row = parsed as Record<string, unknown>;
      const lists = [row.members, row.apps, row.packages];
      const found: string[] = [];
      for (const list of lists) {
        if (Array.isArray(list)) {
          found.push(...list.filter((item): item is string => typeof item === "string"));
        }
      }
      return found;
    }
  } catch {
    return [];
  }
  return [];
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function listShards(repoRoot: string): string[] {
  const named = membersFromWorkspaceApps(repoRoot).map(normalize);
  if (named.length > 0) return [...new Set(named)].sort();
  const shards = workspaceGlobs(repoRoot).flatMap((glob) => expandGlob(repoRoot, glob));
  return [...new Set(shards)].sort();
}

export function inspectMonorepo(scope: string): MonorepoInspect {
  const realScope = realpathSync(scope);
  let repoRoot: string;
  try {
    repoRoot = repoRootOf(realScope);
  } catch {
    return { repoRoot: realScope, relativeScope: ".", shards: [], isMonorepoRoot: false };
  }

  const relativeScope = normalize(relative(repoRoot, realScope) || ".");
  const scopeDir = statSync(realScope).isDirectory() ? realScope : resolve(realScope, "..");
  const relativeDir = normalize(relative(repoRoot, scopeDir) || ".");
  const shards = listShards(repoRoot);
  return {
    repoRoot,
    relativeScope,
    shards,
    isMonorepoRoot: shards.length > 1 && relativeDir === ".",
  };
}

export function rootRefusal(inspect: MonorepoInspect): string {
  const examples = inspect.shards
    .filter((shard) => shard === "packages/auth" || shard.startsWith("packages/"))
    .slice(0, 6);
  const hint = (examples[0] ?? inspect.shards[0] ?? "packages/auth");
  return [
    "Refusing to scan the monorepo root. Review one shard, and start with a tiny smoke:",
    "  npm run review:codebase:save -- " +
      join(inspect.repoRoot, hint) +
      " --pack core --limit 2",
    inspect.shards.length > 0 ? "Shards: " + inspect.shards.join(", ") : "",
  ]
    .filter(Boolean)
    .join("\n");
}