// Local SQLite history for every Jev run. Lives under reviews/ (gitignored).
// Uses node:sqlite so the dashboard has no extra npm dependency.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { estimateJevUsd, jevPricing, type JevPricing } from "../domain/cost.ts";
import {
  compareMetrics,
  reportFingerprint,
  reportMetrics,
  scopeKey,
  scopeKeyFromReport,
  type MetricDelta,
  type RunMetrics,
} from "../domain/scope.ts";
import { isReviewReport, type ReviewReport, type UsageEvent, type Writeup } from "../domain/types.ts";

export type RunSource = "dashboard" | "cli" | "import";
export type RunStatus = "queued" | "running" | "writing" | "ok" | "error";

export type StartRunInput = {
  source: RunSource;
  mode?: string;
  scope: string;
  profile: string;
  packs: string[];
  limit?: number | null;
  files?: string[];
  allowShard?: boolean;
  write?: boolean;
};

export type RunSummary = {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  status: RunStatus;
  source: RunSource;
  mode: string;
  scope: string;
  scopeKey: string;
  profile: string;
  packs: string[];
  limit: number | null;
  files: string[];
  allowShard: boolean;
  writeRequested: boolean;
  writeError: string | null;
  error: string | null;
  screenedFiles: number | null;
  findings: number | null;
  requestChanges: number | null;
  followedSignals: number | null;
  hotCells: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  requests: number | null;
  durationMs: number | null;
  tokensObserved: boolean;
  estimatedUsd: number | null;
  previousId: string | null;
  compare: MetricDelta | null;
};

export type RunDetail = RunSummary & {
  logs: string[];
  pricing: JevPricing;
};

export type CostTotals = {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number | null;
  tokensObserved: boolean;
};

export type RunStore = {
  path: string;
  beginRun: (input: StartRunInput) => RunSummary;
  markStatus: (id: string, status: RunStatus) => void;
  finishRun: (id: string, report: ReviewReport) => RunSummary;
  failRun: (id: string, error: string) => RunSummary;
  setWriteError: (id: string, error: string) => void;
  setLogs: (id: string, logs: string[]) => void;
  saveWriteup: (id: string, writeup: Writeup) => void;
  writeupsFor: (id: string) => Writeup[];
  listRuns: (limit?: number) => RunSummary[];
  getRun: (id: string) => (RunDetail & { report: ReviewReport | null }) | null;
  currentRunId: () => string | null;
  setCurrentRunId: (id: string) => void;
  totals: () => CostTotals;
  touchRecent: (path: string) => void;
  listRecents: (limit?: number) => string[];
  close: () => void;
};

type OpenOptions = {
  path?: string;
  importLegacy?: boolean;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  mode TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  profile TEXT,
  packs TEXT NOT NULL DEFAULT '[]',
  limit_n INTEGER,
  files TEXT NOT NULL DEFAULT '[]',
  allow_shard INTEGER NOT NULL DEFAULT 0,
  write_requested INTEGER NOT NULL DEFAULT 0,
  write_error TEXT,
  error TEXT,
  screened_files INTEGER,
  findings INTEGER,
  request_changes INTEGER,
  followed_signals INTEGER,
  hot_cells INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  requests INTEGER,
  duration_ms INTEGER,
  tokens_observed INTEGER,
  estimated_usd REAL,
  pricing_input REAL,
  pricing_output REAL,
  fingerprint TEXT,
  report_json TEXT,
  logs_json TEXT
);
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step TEXT NOT NULL,
  target TEXT,
  started_at TEXT,
  duration_ms INTEGER,
  input_chars INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  model TEXT,
  failed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS writeups (
  run_id TEXT NOT NULL,
  key TEXT NOT NULL,
  file TEXT,
  line INTEGER,
  dimension TEXT,
  mechanism TEXT,
  claim TEXT,
  quote TEXT,
  change TEXT,
  discard INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  model TEXT,
  written_at TEXT,
  duration_ms INTEGER,
  PRIMARY KEY (run_id, key)
);
CREATE TABLE IF NOT EXISTS recents (
  path TEXT PRIMARY KEY,
  last_used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_scope_created ON runs(scope_key, created_at);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
CREATE INDEX IF NOT EXISTS idx_runs_fingerprint ON runs(fingerprint);
`;

let singleton: RunStore | null = null;

export function reviewsDir(): string {
  if (process.env.REVIEW_DB && process.env.REVIEW_DB !== ":memory:") {
    return dirname(resolve(process.env.REVIEW_DB));
  }
  return resolve(import.meta.dirname, "..", "..", "reviews");
}

export function dbPath(): string {
  return process.env.REVIEW_DB ? resolveEnvPath(process.env.REVIEW_DB) : join(reviewsDir(), "runs.sqlite");
}

export function runStore(): RunStore {
  singleton ??= openRunStore();
  return singleton;
}

export function openRunStore(options: OpenOptions = {}): RunStore {
  const path = options.path ?? dbPath();
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);

  const store = bindStore(db, path);
  if (options.importLegacy !== false && path !== ":memory:") {
    importLegacyReports(store, db);
    importLegacyWriteups(store);
  }
  return store;
}

function bindStore(db: DatabaseSync, path: string): RunStore {
  return {
    path,
    beginRun(input) {
      const id = "run_" + randomUUID();
      const createdAt = new Date().toISOString();
      const packs = input.packs;
      const files = input.files ?? [];
      const key = scopeKey({
        scope: input.scope,
        mode: input.mode ?? "codebase",
        profile: input.profile,
        packs,
        files,
      });
      db.prepare(
        `INSERT INTO runs (
          id, created_at, status, source, mode, scope, scope_key, profile, packs,
          limit_n, files, allow_shard, write_requested
        ) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        createdAt,
        input.source,
        input.mode ?? "codebase",
        input.scope,
        key,
        input.profile,
        JSON.stringify(packs),
        input.limit ?? null,
        JSON.stringify(files),
        input.allowShard ? 1 : 0,
        input.write ? 1 : 0,
      );
      this.setCurrentRunId(id);
      this.touchRecent(input.scope);
      return mustGet(this, id);
    },
    markStatus(id, status) {
      db.prepare("UPDATE runs SET status = ? WHERE id = ?").run(status, id);
    },
    finishRun(id, report) {
      const pricing = jevPricing();
      const metrics = reportMetrics(report);
      const estimatedUsd = estimateJevUsd(report.usage, pricing);
      const finishedAt = new Date().toISOString();
      db.prepare(
        `UPDATE runs SET
          finished_at = ?, status = 'ok', mode = ?, scope = ?, scope_key = ?,
          profile = ?, packs = ?, error = NULL,
          screened_files = ?, findings = ?, request_changes = ?, followed_signals = ?,
          hot_cells = ?, input_tokens = ?, output_tokens = ?, requests = ?,
          duration_ms = ?, tokens_observed = ?, estimated_usd = ?,
          pricing_input = ?, pricing_output = ?, fingerprint = ?, report_json = ?
        WHERE id = ?`,
      ).run(
        finishedAt,
        report.mode,
        report.scope,
        scopeKeyFromReport(report),
        report.config?.profile ?? null,
        JSON.stringify(report.config?.packs ?? []),
        metrics.screenedFiles,
        metrics.findings,
        metrics.requestChanges,
        metrics.followedSignals,
        metrics.hotCells,
        report.usage?.inputTokens ?? null,
        report.usage?.outputTokens ?? null,
        report.usage?.requests ?? null,
        report.usage?.durationMs ?? null,
        report.usage?.tokensObserved ? 1 : 0,
        estimatedUsd,
        pricing.inputUsdPerMtok,
        pricing.outputUsdPerMtok,
        reportFingerprint(report),
        JSON.stringify(report),
        id,
      );
      db.prepare("DELETE FROM usage_events WHERE run_id = ?").run(id);
      const insertEvent = db.prepare(
        `INSERT INTO usage_events (
          run_id, step, target, started_at, duration_ms, input_chars,
          input_tokens, output_tokens, model, failed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const event of report.usage?.events ?? []) {
        insertEvent.run(
          id,
          event.step,
          event.target,
          event.startedAt,
          event.durationMs,
          event.inputChars,
          event.inputTokens,
          event.outputTokens,
          event.model,
          event.failed ? 1 : 0,
        );
      }
      this.setCurrentRunId(id);
      this.touchRecent(report.scope);
      return mustGet(this, id);
    },
    failRun(id, error) {
      db.prepare("UPDATE runs SET status = 'error', finished_at = ?, error = ? WHERE id = ?").run(
        new Date().toISOString(),
        error,
        id,
      );
      return mustGet(this, id);
    },
    setWriteError(id, error) {
      db.prepare("UPDATE runs SET write_error = ?, status = CASE WHEN status = 'writing' THEN 'ok' ELSE status END WHERE id = ?").run(
        error,
        id,
      );
    },
    setLogs(id, logs) {
      db.prepare("UPDATE runs SET logs_json = ? WHERE id = ?").run(JSON.stringify(logs.slice(-80)), id);
    },
    saveWriteup(id, writeup) {
      db.prepare(
        `INSERT INTO writeups (
          run_id, key, file, line, dimension, mechanism, claim, quote, change,
          discard, reason, model, written_at, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, key) DO UPDATE SET
          claim = excluded.claim, quote = excluded.quote, change = excluded.change,
          discard = excluded.discard, reason = excluded.reason, model = excluded.model,
          written_at = excluded.written_at, duration_ms = excluded.duration_ms`,
      ).run(
        id,
        writeup.key,
        writeup.file,
        writeup.line,
        writeup.dimension,
        writeup.mechanism,
        writeup.claim,
        writeup.quote,
        writeup.change,
        writeup.discard ? 1 : 0,
        writeup.reason,
        writeup.model,
        writeup.writtenAt,
        writeup.durationMs,
      );
    },
    writeupsFor(id) {
      return db
        .prepare("SELECT * FROM writeups WHERE run_id = ? ORDER BY written_at")
        .all(id)
        .map((row) => writeupFromRow(row as Record<string, unknown>));
    },
    listRuns(limit = 100) {
      const rows = db
        .prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
        .all(limit)
        .map((row) => summaryFromRow(row as Record<string, unknown>));
      return attachCompare(rows);
    },
    getRun(id) {
      const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      if (!row) return null;
      const summary = summaryFromRow(row);
      if (summary.status === "ok") {
        const previousRow = db
          .prepare(
            "SELECT * FROM runs WHERE scope_key = ? AND status = 'ok' AND created_at < ? AND id != ? ORDER BY created_at DESC LIMIT 1",
          )
          .get(summary.scopeKey, summary.createdAt, summary.id) as Record<string, unknown> | undefined;
        if (previousRow) {
          const previous = summaryFromRow(previousRow);
          summary.previousId = previous.id;
          summary.compare = compareMetrics(metricsOf(summary), metricsOf(previous));
        }
      }
      let report: ReviewReport | null = null;
      if (typeof row.report_json === "string") {
        try {
          const parsed: unknown = JSON.parse(row.report_json);
          if (isReviewReport(parsed)) report = parsed;
        } catch {
          report = null;
        }
      }
      return {
        ...summary,
        logs: parseLogs(row.logs_json),
        pricing: jevPricing(),
        report,
      };
    },
    currentRunId() {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'current_run_id'").get() as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    },
    setCurrentRunId(id) {
      db.prepare("INSERT INTO meta (key, value) VALUES ('current_run_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
        id,
      );
    },
    totals() {
      const row = db
        .prepare(
          `SELECT
            COUNT(*) AS runs,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            SUM(estimated_usd) AS estimated_usd,
            MAX(tokens_observed) AS tokens_observed
          FROM runs WHERE status IN ('ok', 'writing')`,
        )
        .get() as Record<string, unknown>;
      const estimated = typeof row.estimated_usd === "number" ? row.estimated_usd : null;
      return {
        runs: Number(row.runs ?? 0),
        inputTokens: Number(row.input_tokens ?? 0),
        outputTokens: Number(row.output_tokens ?? 0),
        estimatedUsd: estimated,
        tokensObserved: Boolean(row.tokens_observed),
      };
    },
    touchRecent(scope) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO recents (path, last_used_at, use_count) VALUES (?, ?, 1)
         ON CONFLICT(path) DO UPDATE SET last_used_at = excluded.last_used_at, use_count = use_count + 1`,
      ).run(scope, now);
    },
    listRecents(limit = 8) {
      return db
        .prepare("SELECT path FROM recents ORDER BY last_used_at DESC LIMIT ?")
        .all(limit)
        .map((row) => String((row as { path: string }).path));
    },
    close() {
      db.close();
      if (singleton === this) singleton = null;
    },
  };
}

function mustGet(store: RunStore, id: string): RunSummary {
  const row = store.getRun(id);
  if (!row) throw new Error("Run " + id + " was not stored");
  const { logs: _logs, pricing: _pricing, report: _report, ...summary } = row;
  return summary;
}

function attachCompare(rows: RunSummary[]): RunSummary[] {
  const chronological = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lastByKey = new Map<string, RunSummary>();
  const extras = new Map<string, { previousId: string; compare: MetricDelta }>();
  for (const row of chronological) {
    if (row.status !== "ok") continue;
    const previous = lastByKey.get(row.scopeKey);
    if (previous && previous.findings != null && row.findings != null) {
      extras.set(row.id, {
        previousId: previous.id,
        compare: compareMetrics(metricsOf(row), metricsOf(previous)),
      });
    }
    lastByKey.set(row.scopeKey, row);
  }
  return rows.map((row) => {
    const extra = extras.get(row.id);
    return extra ? { ...row, previousId: extra.previousId, compare: extra.compare } : row;
  });
}

function metricsOf(row: RunSummary): RunMetrics {
  return {
    findings: row.findings ?? 0,
    requestChanges: row.requestChanges ?? 0,
    hotCells: row.hotCells ?? 0,
    screenedFiles: row.screenedFiles ?? 0,
    followedSignals: row.followedSignals ?? 0,
  };
}

function summaryFromRow(row: Record<string, unknown>): RunSummary {
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    finishedAt: typeof row.finished_at === "string" ? row.finished_at : null,
    status: row.status as RunStatus,
    source: row.source as RunSource,
    mode: String(row.mode),
    scope: String(row.scope),
    scopeKey: String(row.scope_key),
    profile: String(row.profile ?? ""),
    packs: parseStringArray(row.packs),
    limit: typeof row.limit_n === "number" ? row.limit_n : null,
    files: parseStringArray(row.files),
    allowShard: Boolean(row.allow_shard),
    writeRequested: Boolean(row.write_requested),
    writeError: typeof row.write_error === "string" ? row.write_error : null,
    error: typeof row.error === "string" ? row.error : null,
    screenedFiles: numberOrNull(row.screened_files),
    findings: numberOrNull(row.findings),
    requestChanges: numberOrNull(row.request_changes),
    followedSignals: numberOrNull(row.followed_signals),
    hotCells: numberOrNull(row.hot_cells),
    inputTokens: numberOrNull(row.input_tokens),
    outputTokens: numberOrNull(row.output_tokens),
    requests: numberOrNull(row.requests),
    durationMs: numberOrNull(row.duration_ms),
    tokensObserved: Boolean(row.tokens_observed),
    estimatedUsd: typeof row.estimated_usd === "number" ? row.estimated_usd : null,
    previousId: null,
    compare: null,
  };
}

function writeupFromRow(row: Record<string, unknown>): Writeup {
  return {
    key: String(row.key),
    file: String(row.file ?? ""),
    line: Number(row.line ?? 0),
    dimension: String(row.dimension ?? ""),
    mechanism: String(row.mechanism ?? ""),
    claim: String(row.claim ?? ""),
    quote: String(row.quote ?? ""),
    change: String(row.change ?? ""),
    discard: Boolean(row.discard),
    reason: String(row.reason ?? ""),
    model: String(row.model ?? ""),
    writtenAt: String(row.written_at ?? ""),
    durationMs: Number(row.duration_ms ?? 0),
  };
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseLogs(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveEnvPath(value: string): string {
  return value === ":memory:" ? ":memory:" : resolve(value);
}

function importLegacyReports(store: RunStore, db: DatabaseSync): void {
  const dir = reviewsDir();
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json") && name !== "writeups.json")
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);

  const seen = new Set(
    db
      .prepare("SELECT fingerprint FROM runs WHERE fingerprint IS NOT NULL")
      .all()
      .map((row) => String((row as { fingerprint: string }).fingerprint)),
  );

  for (const file of files) {
    let report: ReviewReport;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!isReviewReport(parsed)) continue;
      report = parsed;
    } catch {
      continue;
    }
    const fingerprint = reportFingerprint(report);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const createdAt = statSync(file).mtime.toISOString();
    const id = "run_" + randomUUID();
    const filesScreened = report.matrix.map((row) => String(row.file).split("/").pop() ?? String(row.file));
    db.prepare(
      `INSERT INTO runs (
        id, created_at, finished_at, status, source, mode, scope, scope_key,
        profile, packs, limit_n, files, allow_shard, write_requested
      ) VALUES (?, ?, ?, 'ok', 'import', ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    ).run(
      id,
      createdAt,
      createdAt,
      report.mode,
      report.scope,
      scopeKeyFromReport(report),
      report.config?.profile ?? "",
      JSON.stringify(report.config?.packs ?? []),
      report.screenedFiles,
      JSON.stringify(filesScreened),
    );
    store.finishRun(id, report);
    db.prepare("UPDATE runs SET created_at = ?, finished_at = ?, source = 'import' WHERE id = ?").run(
      createdAt,
      createdAt,
      id,
    );
    store.touchRecent(report.scope);
  }
}

function importLegacyWriteups(store: RunStore): void {
  const file = join(reviewsDir(), "writeups.json");
  if (!existsSync(file)) return;
  const runId = store.currentRunId();
  if (!runId || store.writeupsFor(runId).length > 0) return;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const rows = parsed && typeof parsed === "object" ? (parsed as { writeups?: unknown }).writeups : null;
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const writeup = row as Writeup;
      if (typeof writeup.key !== "string" || typeof writeup.claim !== "string") continue;
      store.saveWriteup(runId, writeup);
    }
  } catch {
    // Keep going; history import is best-effort.
  }
}
