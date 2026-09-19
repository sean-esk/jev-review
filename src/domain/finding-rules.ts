// Deterministic finding rules the model is not allowed to override.
import { BLOCKING_SEVERITY } from "./config.ts";

const DENY_BLOCK = /if\s*\(\s*session\.role\s*<\s*Roles\.\w+\s*\)\s*\{[^}]*\}/i;

function denyBlockWithoutReturn(evidence: string): string | null {
  const match = evidence.match(DENY_BLOCK);
  if (!match) return null;
  if (!/res\.send\([^}]*Unauthorized/i.test(match[0])) return null;
  if (/\breturn\b/.test(match[0])) return null;
  return match[0];
}

export function remapCorrectnessMechanism(mechanism: string, evidence: string): string {
  if (mechanism !== "legacyPort") return mechanism;
  const block = denyBlockWithoutReturn(evidence);
  if (!block) return mechanism;
  const after = evidence.replace(block, "");
  return /res\.send\(/.test(after) ? "asyncControl" : "condition";
}

export function testsLiveInBackendTests(context: unknown): boolean {
  if (!context || typeof context !== "object" || Array.isArray(context)) return false;
  const value = (context as { testsLiveIn?: unknown }).testsLiveIn;
  return typeof value === "string" && value.includes("backend/tests");
}

export function reviewAction(
  dimension: string,
  severity: number,
  context: unknown,
): "comment" | "request_changes" {
  if (dimension === "testGap" && testsLiveInBackendTests(context)) return "comment";
  return severity >= BLOCKING_SEVERITY ? "request_changes" : "comment";
}
