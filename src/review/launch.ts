// Turn a dashboard (or other) launch spec into the ReviewRequest the
// codebase runner already understands. Keeps the monorepo root / unbounded
// shard refusals — those still fire inside runCodebaseReview.
import { resolveScope } from "../adapters/browse.ts";
import { isPackName, isProfileName, PACKS, type PackName, type ProfileName } from "../domain/policy.ts";
import type { ReviewRequest } from "../domain/policy.ts";
import { resolvePolicy } from "../profiles/resolve.ts";
import { runCodebaseReview } from "./codebase.ts";
import type { Log } from "./workflow.ts";

export type LaunchSpec = {
  scope: string;
  profile: ProfileName;
  packs: PackName[] | undefined;
  limit?: number;
  files?: string[];
  allowShard: boolean;
  write: boolean;
};

export function parseLaunchSpec(body: unknown): LaunchSpec {
  const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawScope = typeof row.scope === "string" ? row.scope : "";
  const resolved = resolveScope(rawScope);
  const files = parseFiles(row.files);
  if (resolved.file && files.length === 0) files.push(resolved.file);

  const profileValue = typeof row.profile === "string" ? row.profile : "level-method";
  if (!isProfileName(profileValue)) throw new Error("Unknown profile " + profileValue);

  const packs = parsePacks(row.pack, row.packs);
  const limit = parseLimit(row.limit);
  const allowShard = Boolean(row.allowShard);
  if (limit == null && files.length === 0 && !allowShard) {
    throw new Error("Set a file limit, name specific files, or allow a full folder scan");
  }

  return {
    scope: resolved.scope,
    profile: profileValue,
    packs,
    limit,
    files: files.length > 0 ? files : undefined,
    allowShard,
    write: row.write !== false,
  };
}

export function launchRequest(spec: LaunchSpec): ReviewRequest {
  return {
    scope: spec.scope,
    policy: resolvePolicy(spec.profile, spec.packs, spec.scope),
    limit: spec.limit,
    files: spec.files,
    allowShard: spec.allowShard,
  };
}

export function runLaunch(spec: LaunchSpec, log: Log) {
  return runCodebaseReview(launchRequest(spec), log);
}

function parseFiles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

function parsePacks(pack: unknown, packs: unknown): PackName[] | undefined {
  const listed: string[] = [];
  if (typeof pack === "string" && pack.trim()) listed.push(...pack.split(","));
  if (Array.isArray(packs)) listed.push(...packs.filter((item): item is string => typeof item === "string"));
  const next = listed.map((item) => item.trim()).filter(Boolean);
  if (next.length === 0) return undefined;
  for (const name of next) {
    if (!isPackName(name)) throw new Error("Unknown pack " + name + " (use " + PACKS.join(", ") + ")");
  }
  return next as PackName[];
}

function parseLimit(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error("Limit must be a positive integer");
  return number;
}
