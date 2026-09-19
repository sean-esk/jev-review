// Build Jev question objects from the resolved policy screens.
import { noul, type Questions } from "@typesafe-ai/sdk";
import type { ReviewPolicy } from "../domain/policy.ts";

export function screenQuestions(policy: ReviewPolicy, mode: "change" | "codebase"): Questions {
  return Object.fromEntries(
    policy.screens.map((screen) => {
      const side = mode === "change" ? screen.change : screen.codebase;
      return [screen.key, noul(side.instructions, side.criteria)];
    }),
  );
}

export function noulMap(policy: ReviewPolicy, answers: unknown): Record<string, number> {
  const row = (answers ?? {}) as Record<string, { noul?: number }>;
  return Object.fromEntries(
    policy.screens.map((screen) => {
      const value = row[screen.key]?.noul;
      if (typeof value !== "number") {
        throw new Error("Missing noul for " + screen.key);
      }
      return [screen.key, value];
    }),
  );
}

export function maxNoulMap(rows: Array<Record<string, number>>): Record<string, number> {
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));
  return Object.fromEntries(
    [...keys].map((key) => [key, Math.max(...rows.map((row) => row[key] ?? 0))]),
  );
}