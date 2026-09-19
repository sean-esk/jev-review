// Local-only dashboard server: a fixed list of static assets from ./public
// plus the saved review report as JSON. Binds to loopback only.
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, relative } from "node:path";
import { listBrowse, workspaceRoot } from "../adapters/browse.ts";
import { bindApiKey, hasApiKey } from "../adapters/jev.ts";
import { writeFinding, writerSettings } from "../adapters/openai-writer.ts";
import { readReport, reportPath, saveReport } from "../adapters/report-store.ts";
import { runStore, type RunSummary } from "../adapters/run-store.ts";
import { readWriteups, upsertWriteup } from "../adapters/writeup-store.ts";
import { estimateJevUsd, formatUsd, jevPricing } from "../domain/cost.ts";
import { findingKey } from "../domain/writeup.ts";
import { parseLaunchSpec, runLaunch, type LaunchSpec } from "../review/launch.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4317);
const REPORT = reportPath();
const PUBLIC_DIR = join(import.meta.dirname, "public");
const MAX_BODY = 16 * 1024;

// Only these files are served; nothing else on disk is reachable.
const assets: Record<string, [file: string, type: string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};

type ActiveJob = {
  id: string;
  logs: string[];
};

let active: ActiveJob | null = null;

function send(res: ServerResponse, status: number, type: string, body: string | Buffer) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:",
  });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function historyPayload() {
  bindApiKey();
  const store = runStore();
  const pricing = jevPricing();
  const totals = store.totals();
  return {
    pricing,
    totals,
    costLabel: formatUsd(totals.estimatedUsd),
    workspace: workspaceRoot(),
    recents: store.listRecents(),
    currentRunId: store.currentRunId(),
    hasKey: hasApiKey(),
    active: active
      ? {
          id: active.id,
          logs: active.logs,
          status: store.getRun(active.id)?.status ?? "running",
          scope: store.getRun(active.id)?.scope ?? "",
        }
      : null,
    runs: store.listRuns(),
  };
}

function reportPayload(runId: string | null) {
  if (!runId) return null;
  const store = runStore();
  const detail = store.getRun(runId);
  if (!detail) return null;
  if (!detail.report) {
    return {
      status: detail.status === "error" ? "error" : "empty",
      source: "history",
      runId: detail.id,
      savedAt: detail.finishedAt ?? detail.createdAt,
      historical: true,
      message:
        detail.error ||
        (detail.status === "running" || detail.status === "writing"
          ? "Review is still running"
          : "No report for this run"),
      writeError: detail.writeError,
      compare: detail.compare,
      previousId: detail.previousId,
    };
  }
  return {
    status: "ok" as const,
    source: "history",
    runId: detail.id,
    savedAt: detail.finishedAt ?? detail.createdAt,
    historical: store.currentRunId() !== detail.id,
    report: detail.report,
    cost: detail.estimatedUsd,
    pricing: jevPricing(),
    writeups: store.writeupsFor(detail.id),
    compare: detail.compare,
    previousId: detail.previousId,
    writeError: detail.writeError,
  };
}

async function latestPayload() {
  const store = runStore();
  const currentId = store.currentRunId();
  const current = currentId ? store.getRun(currentId) : null;
  if (current?.report) return reportPayload(currentId);

  const stored = await readReport(REPORT);
  const source = relative(process.cwd(), REPORT) || REPORT;
  if (stored.status !== "ok") return { source, runId: currentId, pricing: jevPricing(), cost: null, ...stored };

  return {
    source,
    runId: currentId,
    historical: false,
    pricing: jevPricing(),
    cost: estimateJevUsd(stored.report.usage),
    writeups: currentId ? store.writeupsFor(currentId) : await readWriteups(),
    ...stored,
  };
}

async function writeReviews(req: IncomingMessage, res: ServerResponse) {
  const store = runStore();
  let keys: string[] | null = null;
  let runId = store.currentRunId();
  try {
    const body = await readJson(req);
    const row = body && typeof body === "object" ? (body as { keys?: unknown; runId?: unknown }) : {};
    if (Array.isArray(row.keys)) keys = row.keys.filter((key): key is string => typeof key === "string");
    if (typeof row.runId === "string" && row.runId.trim()) runId = row.runId.trim();
  } catch {
    return json(res, 400, { error: "Invalid JSON body", writeups: [] });
  }

  const detail = runId ? store.getRun(runId) : null;
  const stored = detail?.report ? { status: "ok" as const, report: detail.report } : await readReport(REPORT);
  if (stored.status !== "ok") {
    return json(res, 409, { error: "No review report to write up", writeups: [] });
  }

  const findings = stored.report.findings.filter((finding) => !keys || keys.includes(findingKey(finding)));
  try {
    if (runId) store.markStatus(runId, "writing");
    for (const finding of findings) {
      const writeup = await writeFinding(stored.report, finding);
      await upsertWriteup(writeup);
      if (runId) store.saveWriteup(runId, writeup);
    }
    if (runId) store.markStatus(runId, "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) store.setWriteError(runId, message);
    return json(res, 502, {
      error: message,
      writeups: runId ? store.writeupsFor(runId) : await readWriteups(),
    });
  }
  return json(res, 200, { writeups: runId ? store.writeupsFor(runId) : await readWriteups(), runId });
}

async function startRun(req: IncomingMessage, res: ServerResponse) {
  if (active) {
    return json(res, 409, { error: "A review is already running", active: historyPayload().active });
  }

  let spec: LaunchSpec;
  try {
    spec = parseLaunchSpec(await readJson(req));
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }

  bindApiKey();
  if (!hasApiKey()) {
    return json(res, 409, {
      error: "No TypeSafe/Jev API key. Set JEV_API_KEY or TYPESAFE_API_KEY in this fork's .env.",
    });
  }

  const store = runStore();
  const started = store.beginRun({
    source: "dashboard",
    scope: spec.scope,
    profile: spec.profile,
    packs: spec.packs ?? [],
    limit: spec.limit ?? null,
    files: spec.files ?? [],
    allowShard: spec.allowShard,
    write: spec.write,
  });
  active = { id: started.id, logs: [] };
  void executeJob(started.id, spec);
  await Promise.resolve();
  const settled = store.getRun(started.id);
  if (settled?.status === "error") {
    return json(res, 409, { error: settled.error, run: settled, ...historyPayload() });
  }
  return json(res, 202, { run: settled ?? started, ...historyPayload() });
}

async function executeJob(id: string, spec: LaunchSpec) {
  const store = runStore();
  const log = (message: string) => {
    if (active && active.id === id) {
      active.logs.push(message);
      if (active.logs.length > 120) active.logs.splice(0, active.logs.length - 80);
    }
    console.error(message);
  };

  try {
    bindApiKey();
    const report = await runLaunch(spec, log);
    try {
      await saveReport(report, REPORT);
    } catch (error) {
      log("latest.json: " + (error instanceof Error ? error.message : String(error)));
    }
    store.finishRun(id, report);

    if (spec.write && report.findings.length > 0) {
      store.markStatus(id, "writing");
      log("Writing " + report.findings.length + " review notes...");
      try {
        for (const finding of report.findings) {
          log("  write " + finding.file + " [" + finding.dimension + "/" + finding.mechanism + "]");
          const writeup = await writeFinding(report, finding);
          await upsertWriteup(writeup);
          store.saveWriteup(id, writeup);
        }
        store.markStatus(id, "ok");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("write failed: " + message);
        store.setWriteError(id, message);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(message);
    store.failRun(id, message);
  } finally {
    store.setLogs(id, active && active.id === id ? active.logs : []);
    if (active?.id === id) active = null;
  }
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;

  if (pathname === "/api/review" && (method === "GET" || method === "HEAD")) {
    const runId = url.searchParams.get("runId");
    if (runId) {
      const historical = reportPayload(runId);
      if (!historical) return json(res, 404, { error: "Run not found" });
      return json(res, 200, historical);
    }
    return json(res, 200, await latestPayload());
  }

  if (pathname === "/api/writer" && (method === "GET" || method === "HEAD")) {
    return json(res, 200, writerSettings());
  }

  if (pathname === "/api/writeups" && (method === "GET" || method === "HEAD")) {
    const runId = url.searchParams.get("runId") ?? runStore().currentRunId();
    return json(res, 200, { writeups: runId ? runStore().writeupsFor(runId) : await readWriteups(), runId });
  }

  if (pathname === "/api/writeups" && method === "POST") {
    return writeReviews(req, res);
  }

  if (pathname === "/api/runs" && (method === "GET" || method === "HEAD")) {
    return json(res, 200, historyPayload());
  }

  if (pathname === "/api/runs" && method === "POST") {
    return startRun(req, res);
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && (method === "GET" || method === "HEAD")) {
    const detail = reportPayload(runMatch[1]);
    if (!detail) return json(res, 404, { error: "Run not found" });
    return json(res, 200, detail);
  }

  if (pathname === "/api/browse" && (method === "GET" || method === "HEAD")) {
    try {
      return json(res, 200, listBrowse(url.searchParams.get("path") || workspaceRoot()));
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (pathname === "/api/cost" && (method === "GET" || method === "HEAD")) {
    const history = historyPayload();
    return json(res, 200, { pricing: history.pricing, totals: history.totals, costLabel: history.costLabel });
  }

  if (method !== "GET" && method !== "HEAD") {
    return send(res, 405, "text/plain; charset=utf-8", "Method not allowed");
  }

  const asset = assets[pathname];
  if (!asset) return send(res, 404, "text/plain; charset=utf-8", "Not found");

  const [file, type] = asset;
  send(res, 200, type, await readFile(join(PUBLIC_DIR, file)));
}

const startedDirectly =
  import.meta.main === true ||
  (typeof process.argv[1] === "string" && /(?:^|[\\/])server\.ts$/.test(process.argv[1]));

if (startedDirectly) {
  bindApiKey();
  const store = runStore();
  createServer(handle).listen(PORT, HOST, () => {
    const writer = writerSettings();
    const totals = store.totals();
    console.log(`Jev review dashboard: http://${HOST}:${PORT}`);
    console.log(`report: ${relative(process.cwd(), REPORT) || REPORT}`);
    console.log(`history: ${relative(process.cwd(), store.path) || store.path} (${totals.runs} runs, ${formatUsd(totals.estimatedUsd)})`);
    console.log(`writer: ${writer.model} @ ${writer.baseUrl}`);
  });
}

export type { RunSummary };
