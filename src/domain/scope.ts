// Stable keys so two scans of the same folder and files can be compared
// after code changes. Limit is not part of the key — the screened set is.
import { SCREEN_THRESHOLD } from "./config.ts";
import type { ReviewReport } from "./types.ts";

export type ScopeParts = {
  scope: string;
  mode: string;
  profile: string;
  packs: string[];
  files: string[];
};

export type RunMetrics = {
  findings: number;
  requestChanges: number;
  hotCells: number;
  screenedFiles: number;
  followedSignals: number;
};

export type MetricDelta = {
  findingsDelta: number;
  requestChangesDelta: number;
  hotCellsDelta: number;
};

export function normalizeScope(scope: string): string {
  return scope.replace(/\\/g, "/").replace(/\/+$/, "") || scope;
}

export function fileBase(path: string): string {
  const text = path.replace(/\\/g, "/");
  return text.slice(text.lastIndexOf("/") + 1) || text;
}

export function scopeKey(parts: ScopeParts): string {
  return [
    normalizeScope(parts.scope),
    parts.mode,
    parts.profile,
    [...parts.packs].sort().join("+"),
    [...parts.files].map(fileBase).sort().join(","),
  ].join("|");
}

export function filesFromReport(report: ReviewReport): string[] {
  const names = new Set<string>();
  for (const row of report.matrix) names.add(fileBase(String(row.file)));
  return [...names].sort();
}

export function scopeKeyFromReport(report: ReviewReport): string {
  return scopeKey({
    scope: report.scope,
    mode: report.mode,
    profile: report.config?.profile ?? "",
    packs: report.config?.packs ?? [],
    files: filesFromReport(report),
  });
}

export function reportMetrics(report: ReviewReport, threshold = SCREEN_THRESHOLD): RunMetrics {
  return {
    findings: report.findings.length,
    requestChanges: report.findings.filter((finding) => finding.action === "request_changes").length,
    hotCells: report.matrix.reduce((count, row) => {
      return (
        count +
        Object.entries(row).filter(([, value]) => typeof value === "number" && value >= threshold).length
      );
    }, 0),
    screenedFiles: report.screenedFiles,
    followedSignals: report.followedSignals,
  };
}

export function compareMetrics(current: RunMetrics, previous: RunMetrics): MetricDelta {
  return {
    findingsDelta: current.findings - previous.findings,
    requestChangesDelta: current.requestChanges - previous.requestChanges,
    hotCellsDelta: current.hotCells - previous.hotCells,
  };
}

export function reportFingerprint(report: ReviewReport): string {
  return [
    normalizeScope(report.scope),
    report.mode,
    report.usage?.inputTokens ?? "",
    report.usage?.durationMs ?? "",
    report.findings.length,
    report.screenedFiles,
  ].join("|");
}
