// Shapes shared by both review modes and the saved dashboard report.
import type { PackName, ProfileName } from "./policy.ts";

export type ReviewMode = "changes" | "codebase";
export type DimensionKey = string;

export type ChangedFile = {
  path: string;
  patch: string;
};

export type SourceFile = {
  path: string;
  content: string;
};

export type Hunk = {
  id: string;
  startLine: number;
  patch: string;
};

export type Screening<File extends { path: string }> = {
  file: File;
  probabilities: Record<string, number>;
};

export type Signal<File extends { path: string }> = {
  file: File;
  dimension: DimensionKey;
  probability: number;
};

export type Finding<File extends { path: string }> = Signal<File> & {
  line: number;
  locationConfidence: number;
  mechanism: string;
  mechanismConfidence: number;
  severity: number;
  severityConfidence: number;
  owner: string | null;
  ownerConfidence: number | null;
  action: "comment" | "request_changes";
};

export type FileProfile = {
  file: string;
  category: string;
  categoryConfidence: number;
  reviewPriority: number;
  reviewPriorityConfidence: number;
};

export type UsageEvent = {
  step: string;
  target: string | null;
  startedAt: string;
  durationMs: number;
  inputChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
  failed: boolean;
};

export type UsageSummary = {
  requests: number;
  failedRequests: number;
  inputChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  tokensObserved: boolean;
  durationMs: number;
  model: string | null;
  byStep: Array<{
    step: string;
    requests: number;
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number;
  }>;
  events: UsageEvent[];
};

export type LmrFinding = {
  class: string;
  severity: "critical" | "high" | "medium" | "low";
  disposition: "must_fix" | "advisory";
  support: "supported" | "speculative";
  scope: "introduced" | "pre_existing";
  file: string;
  line: number;
  dimension: string;
  mechanism: string;
};

export type ReviewReport = {
  mode: ReviewMode;
  scope: string;
  dimensions: Array<{ key: string; label: string; short: string }>;
  config: {
    screenThreshold: number;
    severityMax: number;
    maxFollowUps: number;
    maxProfiles: number;
    profile: ProfileName;
    packs: PackName[];
    base: string | null;
  };
  shard: { repoRoot: string; member: string } | null;
  screenedFiles: number;
  contextFiles: string[];
  matrix: Array<{ file: string } & Record<string, string | number>>;
  followedSignals: number;
  profiles: FileProfile[];
  workflow: {
    screenedCells: number;
    thresholdSignals: number;
    profiledFiles: number;
    followedSignals: number;
    locatedFindings: number;
    routedFindings: number;
  };
  usage: UsageSummary;
  findings: Array<Omit<Finding<{ path: string }>, "file"> & { file: string }>;
  lmr?: LmrFinding[];
};

// Deliberately loose so a report saved by an older version remains viewable.
export function isReviewReport(value: unknown): value is ReviewReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return (
    typeof report.scope === "string" &&
    typeof report.screenedFiles === "number" &&
    Array.isArray(report.matrix) &&
    typeof report.followedSignals === "number" &&
    Array.isArray(report.findings)
  );
}
