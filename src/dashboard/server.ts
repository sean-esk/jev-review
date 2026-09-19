// Local-only dashboard server: a fixed list of static assets from ./public
// plus the saved review report as JSON. Binds to loopback only.
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, relative } from "node:path";
import { writeFinding, writerSettings } from "../adapters/openai-writer.ts";
import { readReport, reportPath } from "../adapters/report-store.ts";
import { readWriteups, upsertWriteup } from "../adapters/writeup-store.ts";
import { findingKey } from "../domain/writeup.ts";

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

async function writeReviews(req: IncomingMessage, res: ServerResponse) {
  const stored = await readReport(REPORT);
  if (stored.status !== "ok") {
    return json(res, 409, { error: "No review report to write up", writeups: [] });
  }

  let keys: string[] | null = null;
  try {
    const body = await readJson(req);
    const listed = body && typeof body === "object" ? (body as { keys?: unknown }).keys : null;
    if (Array.isArray(listed)) keys = listed.filter((key): key is string => typeof key === "string");
  } catch {
    return json(res, 400, { error: "Invalid JSON body", writeups: [] });
  }

  const findings = stored.report.findings.filter((finding) => !keys || keys.includes(findingKey(finding)));
  try {
    for (const finding of findings) {
      await upsertWriteup(await writeFinding(stored.report, finding));
    }
  } catch (error) {
    return json(res, 502, {
      error: error instanceof Error ? error.message : String(error),
      writeups: await readWriteups(),
    });
  }
  return json(res, 200, { writeups: await readWriteups() });
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const method = req.method ?? "GET";
  const { pathname } = new URL(req.url ?? "/", "http://localhost");

  if (pathname === "/api/review" && (method === "GET" || method === "HEAD")) {
    const source = relative(process.cwd(), REPORT) || REPORT;
    return json(res, 200, { source, ...(await readReport(REPORT)) });
  }

  if (pathname === "/api/writer" && (method === "GET" || method === "HEAD")) {
    return json(res, 200, writerSettings());
  }

  if (pathname === "/api/writeups" && (method === "GET" || method === "HEAD")) {
    return json(res, 200, { writeups: await readWriteups() });
  }

  if (pathname === "/api/writeups" && method === "POST") {
    return writeReviews(req, res);
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
  createServer(handle).listen(PORT, HOST, () => {
    const writer = writerSettings();
    console.log(`Jev review dashboard: http://${HOST}:${PORT}`);
    console.log(`report: ${relative(process.cwd(), REPORT) || REPORT}`);
    console.log(`writer: ${writer.model} @ ${writer.baseUrl}`);
  });
}
