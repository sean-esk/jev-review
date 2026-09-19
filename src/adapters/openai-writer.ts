// OpenAI-compatible chat/completions client for local write-ups (Ollama, LM Studio).
import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Evidence, ReviewReport, Writeup } from "../domain/types.ts";
import {
  findingKey,
  parseWriteupJson,
  sliceSource,
  writerSystemPrompt,
  writerUserPrompt,
  type FindingRef,
} from "../domain/writeup.ts";

const DEFAULT_BASE = "http://127.0.0.1:11434/v1";
const DEFAULT_MODEL = "qwen3.8";
const DEFAULT_TIMEOUT_MS = 120_000;

export type WriterSettings = {
  baseUrl: string;
  model: string;
  hasKey: boolean;
};

export function writerSettings(): WriterSettings {
  const baseUrl = (process.env.WRITE_BASE_URL ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE).trim();
  const model = (process.env.WRITE_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL).trim();
  const key = (process.env.WRITE_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim();
  return { baseUrl, model, hasKey: Boolean(key) };
}

export function writerApiKey(): string {
  return (process.env.WRITE_API_KEY ?? process.env.OPENAI_API_KEY ?? "local").trim() || "local";
}

export function completionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return trimmed + "/chat/completions";
  return trimmed + "/v1/chat/completions";
}

export function resolveEvidence(
  finding: FindingRef & { evidence?: Evidence; line: number; file: string },
  report: ReviewReport,
): Evidence {
  if (finding.evidence?.content?.trim()) return finding.evidence;
  const repoRoot = report.shard?.repoRoot;
  if (!repoRoot) {
    throw new Error("No source region on this finding and no shard root to read from");
  }
  const abs = resolve(repoRoot, finding.file);
  const root = realpathSync(repoRoot);
  let file: string;
  try {
    file = realpathSync(abs);
  } catch {
    throw new Error("Could not read " + finding.file);
  }
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (file !== root && !file.startsWith(prefix)) {
    throw new Error("Refusing to read a path outside the shard");
  }
  return sliceSource(readFileSync(file, "utf8"), finding.line);
}

export async function writeFinding(
  report: ReviewReport,
  finding: FindingRef & {
    evidence?: Evidence;
    line: number;
    file: string;
    severity?: number;
    action?: string;
  },
): Promise<Writeup> {
  const settings = writerSettings();
  if (!settings.model) throw new Error("WRITE_MODEL (or OPENAI_MODEL) is empty");
  const evidence = resolveEvidence(finding, report);
  const started = Date.now();
  const raw = await complete(settings, writerSystemPrompt(), writerUserPrompt(finding, evidence));
  const parsed = parseWriteupJson(raw);
  return {
    key: findingKey(finding),
    file: finding.file,
    line: finding.line,
    dimension: finding.dimension,
    mechanism: finding.mechanism,
    ...parsed,
    model: settings.model,
    writtenAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}

async function complete(settings: WriterSettings, system: string, user: string): Promise<string> {
  const url = completionsUrl(settings.baseUrl);
  const timeout = Number(process.env.WRITE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const payload = {
    model: settings.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  let response = await post(url, { ...payload, response_format: { type: "json_object" } }, timeout);
  if (response.status === 400) {
    response = await post(url, payload, timeout);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error("Local model HTTP " + response.status + (detail ? ": " + detail : ""));
  }
  const body: unknown = await response.json();
  const content = messageContent(body);
  if (!content) throw new Error("Local model returned an empty completion");
  return content;
}

async function post(url: string, payload: unknown, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + writerApiKey(),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Local model timed out after " + timeout + "ms");
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) {
      throw new Error("No local model at " + url + ". Start Ollama or LM Studio, or set WRITE_BASE_URL.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function messageContent(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content : null;
}
