// TypeSafe Jev 1.13 published price. Output tokens are free.
// Override with JEV_INPUT_USD_PER_MTOK / JEV_OUTPUT_USD_PER_MTOK when the
// published rate changes — do not hard-code a guessed price elsewhere.

export const JEV_INPUT_USD_PER_MTOK = 0.042;
export const JEV_OUTPUT_USD_PER_MTOK = 0;

export type JevPricing = {
  inputUsdPerMtok: number;
  outputUsdPerMtok: number;
  label: string;
};

export type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  tokensObserved: boolean;
};

export function jevPricing(): JevPricing {
  return {
    inputUsdPerMtok: numberFromEnv("JEV_INPUT_USD_PER_MTOK", JEV_INPUT_USD_PER_MTOK),
    outputUsdPerMtok: numberFromEnv("JEV_OUTPUT_USD_PER_MTOK", JEV_OUTPUT_USD_PER_MTOK),
    label: "TypeSafe Jev 1.13 published price ($0.042 / 1M input tokens, output free)",
  };
}

export function estimateJevUsd(usage: TokenUsage, pricing = jevPricing()): number | null {
  if (!usage.tokensObserved) return null;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return (input / 1_000_000) * pricing.inputUsdPerMtok + (output / 1_000_000) * pricing.outputUsdPerMtok;
}

export function formatUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "–";
  if (value === 0) return "$0";
  if (value < 0.000001) return "<$0.000001";
  if (value < 0.01) {
    const text = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    return "$" + text;
  }
  return "$" + value.toFixed(4);
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
