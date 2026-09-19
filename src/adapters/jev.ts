// Thin TypeSafe wrapper so every systemOne call is usage-tracked.
import { TypeSafeClient, type Questions, type SystemOneRequest, type SystemOneResult } from "@typesafe-ai/sdk";
import type { UsageTracker } from "./usage.ts";

export type Jev = {
  systemOne: <const Q extends Questions>(
    step: string,
    target: string | null,
    request: SystemOneRequest<Q>,
  ) => Promise<SystemOneResult<Q>>;
};

export function bindApiKey(): void {
  const jev = process.env.JEV_API_KEY?.trim();
  if (!process.env.TYPESAFE_API_KEY?.trim() && jev) {
    process.env.TYPESAFE_API_KEY = jev;
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim() || process.env.JEV_API_KEY?.trim());
}

export function createJev(tracker: UsageTracker): Jev {
  const client = new TypeSafeClient();
  return {
    systemOne(step, target, request) {
      return tracker.measure(step, target, request.state, () => client.systemOne(request));
    },
  };
}