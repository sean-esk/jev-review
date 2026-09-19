// Shared staged orchestration. Each review mode owns discovery and judgments;
// this module owns concurrency, thresholds, ranking, usage, and report assembly.
import { CONCURRENCY, SCREEN_THRESHOLD, SEVERITY_MAX } from "../domain/config.ts";
import { followUpBudget, profileBudget, type ReviewRequest } from "../domain/policy.ts";
import type {
  FileProfile,
  Finding,
  ReviewMode,
  ReviewReport,
  Screening,
  Signal,
  UsageSummary,
} from "../domain/types.ts";

export type Log = (message: string) => void;

export type UsageSink = {
  summarize: () => UsageSummary;
};

type Strategy<File extends { path: string }, Context extends { path: string }> = {
  mode: ReviewMode;
  subject: string;
  context: string;
  discover: (scope: string) => { files: File[]; contextFiles: Context[] };
  screen: (file: File, contextFiles: Context[]) => Promise<Screening<File>>;
  profile: (file: File, probabilities: Record<string, number>) => Promise<FileProfile>;
  locate: (signal: Signal<File>) => Promise<Finding<File> | null>;
};

export async function runReview<File extends { path: string }, Context extends { path: string }>(
  request: ReviewRequest,
  log: Log,
  tracker: UsageSink,
  shard: ReviewReport["shard"],
  strategy: Strategy<File, Context>,
): Promise<ReviewReport> {
  const { files, contextFiles } = strategy.discover(request.scope);
  if (files.length === 0) {
    throw new Error("No " + strategy.subject + " source files found under " + request.scope);
  }

  const maxFollowUps = followUpBudget(files.length, request.maxFollowUps);
  const maxProfiles = profileBudget(files.length, request.maxProfiles);

  log(
    "Screening " +
      files.length +
      " " +
      strategy.subject +
      " files with " +
      contextFiles.length +
      " " +
      strategy.context +
      " files as context (" +
      request.policy.profile +
      " / " +
      request.policy.packs.join("+") +
      ")...",
  );
  const matrix = await mapLimit(files, CONCURRENCY, async (file) => {
    log("  screen " + file.path);
    try {
      return await strategy.screen(file, contextFiles);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error("Screening " + file.path + " failed: " + message, { cause: error });
    }
  });

  const signals = matrix
    .flatMap(({ file, probabilities }) =>
      Object.entries(probabilities).map(
        ([dimension, probability]): Signal<File> => ({ file, dimension, probability }),
      ),
    )
    .filter((signal) => signal.probability >= SCREEN_THRESHOLD)
    .sort((a, b) => b.probability - a.probability);

  const profileCandidates = [...matrix]
    .sort((a, b) => maxProbability(b) - maxProbability(a))
    .slice(0, maxProfiles);
  log("Profiling " + profileCandidates.length + " files...");
  const profiles = await mapLimit(profileCandidates, CONCURRENCY, ({ file, probabilities }) => {
    log("  profile " + file.path);
    return strategy.profile(file, probabilities);
  });

  const followUps = signals.slice(0, maxFollowUps);
  log("Following " + followUps.length + " of " + signals.length + " signals at or above " + SCREEN_THRESHOLD + "...");
  const located = await mapLimit(followUps, CONCURRENCY, (signal) => {
    log("  inspect " + signal.file.path + " [" + signal.dimension + "=" + signal.probability.toFixed(2) + "]");
    return strategy.locate(signal);
  });

  const findings = located
    .filter((finding): finding is Finding<File> => finding !== null)
    .sort((a, b) => b.severity - a.severity);

  return {
    mode: strategy.mode,
    scope: request.scope,
    dimensions: request.policy.screens.map(({ key, label, short }) => ({ key, label, short })),
    config: {
      screenThreshold: SCREEN_THRESHOLD,
      severityMax: SEVERITY_MAX,
      maxFollowUps,
      maxProfiles,
      profile: request.policy.profile,
      packs: request.policy.packs,
      base: request.base ?? request.mergeBaseSha ?? null,
    },
    shard,
    screenedFiles: files.length,
    contextFiles: contextFiles.map((file) => file.path),
    matrix: matrix.map(({ file, probabilities }) => ({ file: file.path, ...probabilities })) as ReviewReport["matrix"],
    followedSignals: followUps.length,
    profiles,
    workflow: {
      screenedCells: files.length * request.policy.screens.length,
      thresholdSignals: signals.length,
      profiledFiles: profiles.length,
      followedSignals: followUps.length,
      locatedFindings: findings.length,
      routedFindings: findings.filter((finding) => finding.owner !== null).length,
    },
    usage: tracker.summarize(),
    findings: findings.map(({ file, ...finding }) => ({ file: file.path, ...finding })),
  };
}

function maxProbability<File extends { path: string }>(screening: Screening<File>): number {
  return Math.max(0, ...Object.values(screening.probabilities));
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  callback: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await callback(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}