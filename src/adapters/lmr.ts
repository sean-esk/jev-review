// Map a Jev report onto the level-method-review-pr finding contract. Jev
// does not write prose fields.
import { MIN_LOCATION_CONFIDENCE } from "../domain/config.ts";
import type { LmrFinding, ReviewReport } from "../domain/types.ts";

const CLASS_BY_DIMENSION: Record<string, string> = {
  correctness: "correctness",
  security: "security",
  reliability: "reliability",
  compatibility: "compatibility",
  testGap: "tests",
  dataHandling: "data",
  apiSurface: "api",
  contracts: "contracts",
  deadCode: "maintainability",
  legacy: "maintainability",
  architecture: "maintainability",
  isolation: "isolation",
  productConsistency: "product",
};

export function toLmrFindings(report: ReviewReport): LmrFinding[] {
  return report.findings.map((finding) => ({
    class: CLASS_BY_DIMENSION[finding.dimension] ?? finding.dimension,
    severity:
      finding.severity >= 2.5
        ? "critical"
        : finding.severity >= 2
          ? "high"
          : finding.severity >= 1.5
            ? "medium"
            : "low",
    disposition:
      finding.action === "request_changes" && finding.locationConfidence >= MIN_LOCATION_CONFIDENCE
        ? "must_fix"
        : "advisory",
    support: finding.locationConfidence >= MIN_LOCATION_CONFIDENCE ? "supported" : "speculative",
    scope: report.mode === "changes" ? "introduced" : "pre_existing",
    file: finding.file,
    line: finding.line,
    dimension: finding.dimension,
    mechanism: finding.mechanism,
  }));
}