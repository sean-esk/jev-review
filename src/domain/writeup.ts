// Finding keys, evidence slices, and the writer prompt. Pure; no I/O.
import type { Evidence, Writeup } from "./types.ts";

export const WRITE_REGION_LINES = 80;

export type FindingRef = {
  file: string;
  line: number;
  dimension: string;
  mechanism: string;
};

export function findingKey(finding: FindingRef): string {
  return [finding.file, String(finding.line), finding.dimension, finding.mechanism].join("\t");
}

export function evidenceFromContent(
  startLine: number,
  content: string,
): Evidence {
  const lines = content.split("\n");
  return {
    startLine,
    endLine: startLine + Math.max(0, lines.length - 1),
    content,
  };
}

export function sliceSource(content: string, startLine: number, lineCount = WRITE_REGION_LINES): Evidence {
  const lines = content.split("\n");
  const start = Math.max(1, startLine);
  const from = start - 1;
  const slice = lines.slice(from, from + lineCount).join("\n");
  return evidenceFromContent(start, slice);
}

export function writerSystemPrompt(): string {
  return [
    "Write a code review note from a structured finding and the source region that was scored.",
    "Use only that evidence. Do not invent files, lines, or behavior that is not in the evidence.",
    "Return a JSON object with exactly these keys:",
    '{ "claim": string, "quote": string, "change": string, "discard": boolean, "reason": string }',
    "claim: one sentence naming the defect, or why this is not a defect.",
    "quote: the shortest exact excerpt from the evidence that supports the claim.",
    "change: the concrete edit to make. Empty string when discard is true.",
    "discard: true when the evidence does not support a real defect.",
    "reason: filled only when discard is true; otherwise empty.",
  ].join(" ");
}

export function writerUserPrompt(
  finding: FindingRef & { severity?: number; action?: string },
  evidence: Evidence,
): string {
  return [
    "Finding:",
    "file: " + finding.file,
    "line: " + finding.line,
    "dimension: " + finding.dimension,
    "mechanism: " + finding.mechanism,
    finding.severity != null ? "severity: " + finding.severity : "",
    finding.action ? "action: " + finding.action : "",
    "",
    "Evidence (lines " + evidence.startLine + "–" + evidence.endLine + "):",
    evidence.content,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function parseWriteupJson(raw: string): Pick<Writeup, "claim" | "quote" | "change" | "discard" | "reason"> {
  const text = stripFence(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Local model did not return JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Local model JSON was not an object");
  }
  const row = parsed as Record<string, unknown>;
  const discard = row.discard === true || row.discard === "true";
  const claim = asString(row.claim);
  if (!claim) throw new Error("Local model omitted claim");
  return {
    claim,
    quote: asString(row.quote),
    change: discard ? "" : asString(row.change),
    discard,
    reason: discard ? asString(row.reason) : "",
  };
}

export function matchingWriteup(
  writeups: Writeup[],
  finding: FindingRef,
): Writeup | undefined {
  const key = findingKey(finding);
  return writeups.find((entry) => entry.key === key);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}
