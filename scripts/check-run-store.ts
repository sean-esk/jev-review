// In-memory smoke for Jev cost math and the SQLite run history store.
import assert from "node:assert/strict";
import { estimateJevUsd, formatUsd, JEV_INPUT_USD_PER_MTOK } from "../src/domain/cost.ts";
import { compareMetrics, reportFingerprint, scopeKeyFromReport } from "../src/domain/scope.ts";
import { openRunStore } from "../src/adapters/run-store.ts";
import type { ReviewReport } from "../src/domain/types.ts";

const million = estimateJevUsd({ inputTokens: 1_000_000, outputTokens: 999, tokensObserved: true });
assert.equal(million, JEV_INPUT_USD_PER_MTOK);
assert.equal(estimateJevUsd({ inputTokens: 43171, outputTokens: 1155, tokensObserved: false }), null);
assert.ok(Math.abs((estimateJevUsd({ inputTokens: 43171, outputTokens: 1155, tokensObserved: true }) ?? 0) - 0.001813182) < 1e-9);
assert.equal(formatUsd(0.001813182), "$0.001813");
assert.equal(formatUsd(null), "–");

function report(scope: string, findings: number, inputTokens: number, durationMs: number): ReviewReport {
  return {
    mode: "codebase",
    scope,
    dimensions: [],
    config: {
      screenThreshold: 0.7,
      severityMax: 3,
      maxFollowUps: 8,
      maxProfiles: 5,
      profile: "level-method",
      packs: ["core"],
      base: null,
    },
    shard: null,
    screenedFiles: 1,
    contextFiles: [],
    matrix: [{ file: "backend/src/api/contacts.ts", correctness: 0.86, testGap: 0.4 }],
    followedSignals: 1,
    profiles: [],
    workflow: {
      screenedCells: 5,
      thresholdSignals: 1,
      profiledFiles: 1,
      followedSignals: 1,
      locatedFindings: findings,
      routedFindings: findings,
    },
    usage: {
      requests: 2,
      failedRequests: 0,
      inputChars: 100,
      inputTokens,
      outputTokens: 10,
      totalTokens: inputTokens + 10,
      tokensObserved: true,
      durationMs,
      model: "jev-1.13.0",
      byStep: [],
      events: [
        {
          step: "screen",
          target: "contacts.ts",
          startedAt: "2026-09-18T00:00:00.000Z",
          durationMs,
          inputChars: 100,
          inputTokens,
          outputTokens: 10,
          model: "jev-1.13.0",
          failed: false,
        },
      ],
    },
    findings: Array.from({ length: findings }, () => ({
      file: "backend/src/api/contacts.ts",
      dimension: "security",
      probability: 0.86,
      line: 1,
      locationConfidence: 0.7,
      mechanism: "authorization",
      mechanismConfidence: 0.7,
      severity: 2.1,
      severityConfidence: 0.7,
      owner: "backend",
      ownerConfidence: 0.6,
      action: "request_changes" as const,
    })),
  };
}

const first = report("/repo/backend/src/api", 2, 1000, 100);
const second = report("/repo/backend/src/api", 1, 900, 90);
assert.equal(scopeKeyFromReport(first), scopeKeyFromReport(second));
assert.notEqual(reportFingerprint(first), reportFingerprint(second));
assert.deepEqual(compareMetrics({ findings: 1, requestChanges: 1, hotCells: 1, screenedFiles: 1, followedSignals: 1 }, { findings: 2, requestChanges: 2, hotCells: 1, screenedFiles: 1, followedSignals: 1 }), {
  findingsDelta: -1,
  requestChangesDelta: -1,
  hotCellsDelta: 0,
});

const store = openRunStore({ path: ":memory:", importLegacy: false });
const started = store.beginRun({
  source: "dashboard",
  scope: first.scope,
  profile: "level-method",
  packs: ["core"],
  limit: 1,
  files: ["contacts.ts"],
  write: true,
});
store.finishRun(started.id, first);
const later = store.beginRun({
  source: "dashboard",
  scope: second.scope,
  profile: "level-method",
  packs: ["core"],
  limit: 1,
  files: ["contacts.ts"],
});
store.finishRun(later.id, second);

const listed = store.listRuns();
assert.equal(listed.length, 2);
assert.equal(listed[0].id, later.id);
assert.equal(listed[0].compare?.findingsDelta, -1);
assert.equal(listed[0].previousId, started.id);
assert.equal(listed[1].compare, null);
assert.ok((listed[0].estimatedUsd ?? 0) > 0);
assert.equal(store.totals().runs, 2);
assert.equal(store.listRecents()[0], first.scope);

store.saveWriteup(later.id, {
  key: "backend/src/api/contacts.ts\t1\tsecurity\tauthorization",
  file: "backend/src/api/contacts.ts",
  line: 1,
  dimension: "security",
  mechanism: "authorization",
  claim: "Deny continues into the handler.",
  quote: "if (session.role < Roles.Coach)",
  change: "Return after sending Unauthorized.",
  discard: false,
  reason: "",
  model: "qwen3.8",
  writtenAt: "2026-09-18T00:00:00.000Z",
  durationMs: 12,
});
assert.equal(store.writeupsFor(later.id).length, 1);
store.close();

console.log("run-store ok");
