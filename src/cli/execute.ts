import { relative } from "node:path";
import { hasRef } from "../adapters/git.ts";
import { bindApiKey, hasApiKey } from "../adapters/jev.ts";
import { toLmrFindings } from "../adapters/lmr.ts";
import { reportPath, saveReport } from "../adapters/report-store.ts";
import { runStore } from "../adapters/run-store.ts";
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
  const id = persistStart(request);
  try {
    const report = await run(request, console.error);
    if (request.mapLmr) report.lmr = toLmrFindings(report);
    persistFinish(id, report);
    console.error(formatUsage(report.usage));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    persistFail(id, error);
    throw error;
  }
}

export async function saveReview(run: Runner): Promise<void> {
  const request = prepare();
  if (!request) return;
  const out = reportPath();
  const outLabel = relative(process.cwd(), out) || out;
  const id = persistStart(request);

  try {
    const report = await run(request, console.error);
    if (request.mapLmr) report.lmr = toLmrFindings(report);
    await saveReport(report, out);
    persistFinish(id, report);
    console.error("saved " + outLabel);
    console.error(formatUsage(report.usage));
  } catch (error) {
    persistFail(id, error);
    console.error(error instanceof Error ? error.message : String(error));
    console.error("review failed; " + outLabel + " unchanged");
    process.exit(1);
  }
}

function persistStart(request: ReviewRequest): string | null {
  try {
    return runStore().beginRun({
      source: "cli",
      scope: request.scope,
      profile: request.policy.profile,
      packs: request.policy.packs,
      limit: request.limit ?? null,
      files: request.files ?? [],
      allowShard: request.allowShard,
      write: false,
    }).id;
  } catch (error) {
    console.error("run history: " + (error instanceof Error ? error.message : String(error)));
    return null;
  }
}

function persistFinish(id: string | null, report: ReviewReport): void {
  if (!id) return;
  try {
    runStore().finishRun(id, report);
  } catch (error) {
    console.error("run history: " + (error instanceof Error ? error.message : String(error)));
  }
}

function persistFail(id: string | null, error: unknown): void {
  if (!id) return;
  try {
    runStore().failRun(id, error instanceof Error ? error.message : String(error));
  } catch (persistError) {
    console.error("run history: " + (persistError instanceof Error ? persistError.message : String(persistError)));
  }
}