// CLI flags for both review modes. Unknown flags fail closed.
import { resolve } from "node:path";
import { isPackName, isProfileName, type PackName, type ProfileName } from "../domain/policy.ts";

export const USAGE = `Usage:
  npm run review:codebase:save -- <shard-or-file> [options]
  npm run review:changes:save -- <repo-or-shard> [options]

Small-folder smoke (do not scan a package root or the monorepo root):
  npm run review:codebase:save -- /path/to/LM-Apps-Monorepo/packages/auth/src --pack core --limit 2 --files roles.ts,resolve-roles.ts

Options:
  --profile generic|level-method   default: level-method
  --pack core[,contracts,...]      repeatable; default: auto from path
  --base <ref>|worktree            merge-base left side (LM default: origin/staging when that ref exists)
  --merge-base-sha <sha>
  --head-sha <sha>
  --limit <n>                      screen at most n source files
  --files <path,path>              explicit files (basename or repo-relative)
  --max-follow-ups <n>
  --max-profiles <n>
  --allow-shard                    permit a full workspace-member scan
  --map-lmr                        also write Level Method review-shaped findings
  --help
`;

export type ParsedArgs = {
  help: boolean;
  scope: string;
  profile: ProfileName;
  packs: PackName[] | undefined;
  base?: string;
  mergeBaseSha?: string;
  headSha?: string;
  limit?: number;
  files?: string[];
  maxFollowUps?: number;
  maxProfiles?: number;
  allowShard: boolean;
  mapLmr: boolean;
};

function need(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) throw new Error(flag + " requires a value");
  return value;
}

function intFlag(args: string[], index: number, flag: string): number {
  const value = Number(need(args, index, flag));
  if (!Number.isInteger(value) || value < 1) throw new Error(flag + " must be a positive integer");
  return value;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let scope: string | undefined;
  let profile: ProfileName = "level-method";
  let packs: PackName[] | undefined;
  let base: string | undefined;
  let mergeBaseSha: string | undefined;
  let headSha: string | undefined;
  let limit: number | undefined;
  let files: string[] | undefined;
  let maxFollowUps: number | undefined;
  let maxProfiles: number | undefined;
  let allowShard = false;
  let mapLmr = false;
  let help = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--profile": {
        const value = need(args, ++index, "--profile");
        if (!isProfileName(value)) throw new Error("Unknown --profile " + value);
        profile = value;
        break;
      }
      case "--pack": {
        const value = need(args, ++index, "--pack");
        const next = value.split(",").map((part) => part.trim()).filter(Boolean);
        for (const pack of next) {
          if (!isPackName(pack)) throw new Error("Unknown --pack " + pack);
        }
        packs = [...(packs ?? []), ...next] as PackName[];
        break;
      }
      case "--base":
        base = need(args, ++index, "--base");
        break;
      case "--merge-base-sha":
        mergeBaseSha = need(args, ++index, "--merge-base-sha");
        break;
      case "--head-sha":
        headSha = need(args, ++index, "--head-sha");
        break;
      case "--limit":
        limit = intFlag(args, ++index, "--limit");
        break;
      case "--files":
        files = need(args, ++index, "--files")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        break;
      case "--max-follow-ups":
        maxFollowUps = intFlag(args, ++index, "--max-follow-ups");
        break;
      case "--max-profiles":
        maxProfiles = intFlag(args, ++index, "--max-profiles");
        break;
      case "--allow-shard":
        allowShard = true;
        break;
      case "--map-lmr":
        mapLmr = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error("Unknown flag: " + arg + "\n" + USAGE);
        if (scope) throw new Error("Unexpected argument: " + arg + "\n" + USAGE);
        scope = arg;
    }
  }

  return {
    help,
    scope: resolve(scope ?? "."),
    profile,
    packs,
    base,
    mergeBaseSha,
    headSha,
    limit,
    files,
    maxFollowUps,
    maxProfiles,
    allowShard,
    mapLmr,
  };
}