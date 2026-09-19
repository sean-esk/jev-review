import { relative } from "node:path";
import { hasRef } from "../adapters/git.ts";
import { bindApiKey, hasApiKey } from "../adapters/jev.ts";
import { toLmrFindings } from "../adapters/lmr.ts";
import { reportPath, saveReport } from "../adapters/report-store.ts";
import { formatUsage } from "../adapters/usage.ts";
import type { ReviewRequest } from "../domain/policy.ts";
import type { ReviewReport } from "../domain/types.ts";
import { resolvePolicy } from "../profiles/resolve.ts";
import type { Log } from "../review/workflow.ts";
import { parseArgs, USAGE } from "./args.ts";

type Runner = (request: ReviewRequest, log: Log) => Promise<ReviewReport>;

export function loadRequest(argv = process.argv): ReviewRequest | { help: true } {
  const args = parseArgs(argv);
  if (args.help) return { help: true };
  const policy = resolvePolicy(args.profile, args.packs, args.scope);
  const base =
    args.base === "worktree"
      ? undefined
      : args.base ??
        (policy.defaultBase && hasRef(args.scope, policy.defaultBase) ? policy.defaultBase : undefined);
  return {
    scope: args.scope,
    policy,
    base,
    mergeBaseSha: args.mergeBaseSha,
    headSha: args.headSha,
    limit: args.limit,
    files: args.files,
    maxFollowUps: args.maxFollowUps,
    maxProfiles: args.maxProfiles,
    allowShard: args.allowShard,
    mapLmr: args.mapLmr,
  };
}

function prepare(): ReviewRequest | null {
  bindApiKey();
  const loaded = loadRequest();
  if ("help" in loaded) {
    console.log(USAGE);
    return null;
  }
  if (!hasApiKey()) {
    console.error(
      "No TypeSafe/Jev API key. Set TYPESAFE_API_KEY or JEV_API_KEY in this fork's .env (from the monorepo .env). Do not commit it.",
    );
    process.exitCode = 1;
    return null;
  }
  return loaded;
}

export async function printReview(run: Runner): Promise<void> {
  const request = prepare();
  if (!request) return;
  const report = await run(request, console.error);
  if (request.mapLmr) report.lmr = toLmrFindings(report);
  console.error(formatUsage(report.usage));
  console.log(JSON.stringify(report, null, 2));
}

export async function saveReview(run: Runner): Promise<void> {
  const request = prepare();
  if (!request) return;
  const out = reportPath();
  const outLabel = relative(process.cwd(), out) || out;

  try {
    const report = await run(request, console.error);
    if (request.mapLmr) report.lmr = toLmrFindings(report);
    await saveReport(report, out);
    console.error("saved " + outLabel);
    console.error(formatUsage(report.usage));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("review failed; " + outLabel + " unchanged");
    process.exit(1);
  }
}