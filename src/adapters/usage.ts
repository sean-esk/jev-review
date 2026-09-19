// Records per-request Jev usage. Prefers API token counts; falls back to
// serialized state size when the response omits usage.
import { estimateJevUsd, formatUsd } from "../domain/cost.ts";
import type { UsageEvent, UsageSummary } from "../domain/types.ts";

export type UsageTracker = {
  measure: <T>(step: string, target: string | null, state: unknown, fn: () => Promise<T>) => Promise<T>;
  summarize: () => UsageSummary;
};

export function readUsage(result: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
} {
  if (!result || typeof result !== "object") {
    return { inputTokens: null, outputTokens: null, model: null };
  }
  const row = result as Record<string, unknown>;
  const model = typeof row.model === "string" ? row.model : null;
  const usage = row.usage;
  if (!usage || typeof usage !== "object") {
    return { inputTokens: null, outputTokens: null, model };
  }
  const fields = usage as Record<string, unknown>;
  return {
    inputTokens: numberish(fields.input_tokens ?? fields.inputTokens ?? fields.prompt_tokens),
    outputTokens: numberish(fields.output_tokens ?? fields.outputTokens ?? fields.completion_tokens),
    model,
  };
}

export function estimateChars(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

export function createUsageTracker(log?: (message: string) => void): UsageTracker {
  const events: UsageEvent[] = [];

  return {
    async measure(step, target, state, fn) {
      const started = Date.now();
      const inputChars = estimateChars(state);
      try {
        const result = await fn();
        const usage = readUsage(result);
        const event: UsageEvent = {
          step,
          target,
          startedAt: new Date(started).toISOString(),
          durationMs: Date.now() - started,
          inputChars,
          failed: false,
          ...usage,
        };
        events.push(event);
        log?.(formatEvent(event));
        return result;
      } catch (error) {
        const event: UsageEvent = {
          step,
          target,
          startedAt: new Date(started).toISOString(),
          durationMs: Date.now() - started,
          inputChars,
          inputTokens: null,
          outputTokens: null,
          model: null,
          failed: true,
        };
        events.push(event);
        log?.(formatEvent(event) + " failed");
        throw error;
      }
    },
    summarize() {
      return summarizeUsage(events);
    },
  };
}

export function summarizeUsage(events: UsageEvent[]): UsageSummary {
  const inputTokens = sumObserved(events.map((event) => event.inputTokens));
  const outputTokens = sumObserved(events.map((event) => event.outputTokens));
  const tokensObserved = events.some(
    (event) => event.inputTokens != null || event.outputTokens != null,
  );
  const byStep = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const list = byStep.get(event.step) ?? [];
    list.push(event);
    byStep.set(event.step, list);
  }

  return {
    requests: events.length,
    failedRequests: events.filter((event) => event.failed).length,
    inputChars: events.reduce((sum, event) => sum + event.inputChars, 0),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens != null && outputTokens != null ? inputTokens + outputTokens : inputTokens ?? outputTokens,
    tokensObserved,
    durationMs: events.reduce((sum, event) => sum + event.durationMs, 0),
    model: events.find((event) => event.model)?.model ?? null,
    byStep: [...byStep.entries()].map(([step, list]) => ({
      step,
      requests: list.length,
      inputTokens: sumObserved(list.map((event) => event.inputTokens)),
      outputTokens: sumObserved(list.map((event) => event.outputTokens)),
      durationMs: list.reduce((sum, event) => sum + event.durationMs, 0),
    })),
    events,
  };
}

export function formatUsage(summary: UsageSummary): string {
  const tokens = summary.tokensObserved
    ? `${summary.inputTokens ?? "?"} in + ${summary.outputTokens ?? "?"} out tokens`
    : `${summary.inputChars} input chars, tokens not reported`;
  const cost = estimateJevUsd(summary);
  const priced = cost != null ? `, ~${formatUsd(cost)}` : "";
  return `Jev usage: ${summary.requests} requests, ${tokens}, ${(summary.durationMs / 1000).toFixed(1)}s${priced}`;
}

function formatEvent(event: UsageEvent): string {
  const tokens =
    event.inputTokens != null || event.outputTokens != null
      ? `in=${event.inputTokens ?? "?"} out=${event.outputTokens ?? "?"}`
      : `chars=${event.inputChars}`;
  const target = event.target ? " " + event.target : "";
  return `  jev ${event.step}${target}  ${tokens}  ${event.durationMs}ms`;
}

function numberish(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumObserved(values: Array<number | null>): number | null {
  if (!values.some((value) => value != null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}