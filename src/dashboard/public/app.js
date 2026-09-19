// Mirrors SCREEN_THRESHOLD in src/domain/config.ts: signals at or above it are followed.
const THRESHOLD = 0.7;
// Severity is an expected score on the 0–3 rubric in src/domain/config.ts.
const SEVERITY_MAX = 3;

const DEFAULT_DIMENSIONS = [
  ["correctness", "Correctness", "Corr"],
  ["security", "Security", "Sec"],
  ["reliability", "Reliability", "Rel"],
  ["compatibility", "Compatibility", "Compat"],
  ["testGap", "Test gap", "Tests"],
];

function dimensionsFor(report) {
  return Array.isArray(report.dimensions)
    ? report.dimensions.map(({ key, label, short }) => [key, label, short])
    : DEFAULT_DIMENSIONS;
}

const app = document.getElementById("app");
const meta = document.getElementById("meta");
let showValues = false;
let lastState = null;
let lastKey = "";
let writeups = [];
let writer = { baseUrl: "", model: "", hasKey: false };
let writeBusy = false;
let writeError = "";
let launchMounted = false;
let browseOpen = false;
let browseState = null;
let launchError = "";
let viewingRunId = "";
let pollTimer = 0;
let history = {
  runs: [],
  recents: [],
  totals: { runs: 0, inputTokens: 0, estimatedUsd: null },
  pricing: { inputUsdPerMtok: 0.042, outputUsdPerMtok: 0, label: "" },
  workspace: "",
  currentRunId: null,
  hasKey: false,
  active: null,
};
const launchRoot = document.getElementById("launch");

function findingKey(finding) {
  return [finding.file, finding.line, finding.dimension, finding.mechanism].join("\t");
}

function writeupFor(finding) {
  const key = findingKey(finding);
  return writeups.find((entry) => entry.key === key) ?? null;
}

// All untrusted text goes through text nodes, never innerHTML.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "style") {
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    } else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const isNum = (value) => typeof value === "number" && Number.isFinite(value);
const fixed = (value, digits = 2) => (isNum(value) ? value.toFixed(digits) : "–");

function formatUsd(value) {
  if (!isNum(value)) return "–";
  if (value === 0) return "$0";
  if (value < 0.000001) return "<$0.000001";
  if (value < 0.01) return "$" + value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return "$" + value.toFixed(4);
}

function jevCost(usage) {
  if (!usage?.tokensObserved) return null;
  const inputRate = history.pricing?.inputUsdPerMtok ?? 0.042;
  const outputRate = history.pricing?.outputUsdPerMtok ?? 0;
  return ((usage.inputTokens ?? 0) / 1e6) * inputRate + ((usage.outputTokens ?? 0) / 1e6) * outputRate;
}

function deltaText(value, word) {
  if (!isNum(value)) return "";
  if (value === 0) return "same " + word;
  return (value > 0 ? "+" : "−") + Math.abs(value) + " " + word;
}

function ago(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const units = [
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [size, unit] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  }
  return "just now";
}

function splitPath(path) {
  const text = String(path ?? "");
  const cut = text.lastIndexOf("/") + 1;
  return [text.slice(0, cut), text.slice(cut)];
}

// Sequential single-hue ramp, theme-aware through CSS custom properties.
function fill(p) {
  const x = Math.min(1, Math.max(0, p));
  return x <= 0.5
    ? `color-mix(in oklab, var(--seq-mid) ${(x * 200).toFixed(1)}%, var(--seq-lo))`
    : `color-mix(in oklab, var(--seq-hi) ${((x - 0.5) * 200).toFixed(1)}%, var(--seq-mid))`;
}

function section(label, aside, ...content) {
  const expanded = label === "Review funnel" || label === "Findings" || label === "Run history";
  return h(
    "details",
    { class: "block", open: expanded },
    h(
      "summary",
      { class: "block-head" },
      h("h2", {}, label),
      h("span", { class: "block-aside" }, aside),
    ),
    ...content,
  );
}

function quiet(title, detail, command) {
  return h(
    "div",
    { class: "quiet" },
    h("p", { class: "quiet-title" }, title),
    detail && h("p", { class: "quiet-detail" }, detail),
    command && h("code", { class: "quiet-command" }, command),
  );
}

function summary(report) {
  const findings = report.findings;
  const blocking = findings.filter((f) => f.action === "request_changes").length;
  const tests = report.contextFiles ?? report.changedTestFiles ?? [];
  const testLabel = report.mode === "codebase" ? "test files" : "changed tests";
  const stats = [
    { value: report.screenedFiles, label: "files" },
    { value: tests.length, label: testLabel, title: tests.join("\n") || null },
    { value: report.followedSignals, label: "investigated", title: "potential concerns at or above " + THRESHOLD.toFixed(2) + " reviewed for evidence" },
    { value: findings.length, label: "findings", cls: "lead" },
    { value: blocking, label: "request changes", cls: blocking > 0 ? "alert" : "" },
  ];
  return h(
    "dl",
    { class: "stats" },
    stats.map((stat) =>
      h(
        "div",
        { class: `stat ${stat.cls ?? ""}`, title: stat.title },
        h("dt", {}, stat.label),
        h("dd", {}, isNum(stat.value) ? stat.value : "–"),
      ),
    ),
  );
}

function workflow(report) {
  const flow = report.workflow;
  if (!flow) return null;

  const categoryCount = dimensionsFor(report).length;
  const fileKind = report.mode === "codebase" ? "complete source files" : "changed source files";
  const steps = [
    {
      value: flow.screenedCells,
      label: "risk checks",
      detail: "file × category",
      title: "One screening probability for every file and concern category",
    },
    {
      value: flow.thresholdSignals,
      label: "flagged",
      detail: "at least " + THRESHOLD.toFixed(2),
      title: "Screening probabilities at or above the follow-up threshold",
    },
    {
      value: flow.followedSignals,
      label: "investigated",
      detail: "evidence review",
      title: "Highest-risk potential concerns selected for deeper evidence review",
    },
    {
      value: flow.locatedFindings,
      label: "supported",
      detail: "evidence found",
      title: "Concerns supported by a concrete source region and mechanism",
    },
    {
      value: flow.routedFindings,
      label: "assigned",
      detail: "owner suggested",
      title: "Higher-severity findings assigned to a reviewer specialty",
    },
  ];

  return section(
    "Review funnel",
    null,
    h(
      "p",
      { class: "section-note" },
      report.screenedFiles + " " + fileKind + " were checked across " + categoryCount + " concern categories. Screening is broad; only higher probabilities continue to evidence review.",
    ),
    h(
      "ol",
      { class: "flow" },
      steps.map((step, index) =>
        h(
          "li",
          { title: step.title },
          index > 0 && h("span", { class: "flow-arrow", "aria-hidden": "true" }, "→"),
          h(
            "span",
            { class: "flow-step" },
            h("strong", {}, isNum(step.value) ? step.value : "–"),
            h("span", {}, step.label),
            h("small", {}, step.detail),
          ),
        ),
      ),
    ),
  );
}

function profiles(report) {
  const list = report.profiles;
  if (!Array.isArray(list) || list.length === 0) return null;
  const categoryHeading = report.mode === "codebase" ? "Role" : "Change";

  const table = h(
    "table",
    { class: "profiles" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        ["File", categoryHeading, "Priority"].map((label) => h("th", { scope: "col" }, label)),
      ),
    ),
    h(
      "tbody",
      {},
      list.map((profile) => {
        const [dir, base] = splitPath(profile.file);
        const category = profile.category ?? profile.changeType ?? "–";
        const categoryConfidence = profile.categoryConfidence ?? profile.changeTypeConfidence;
        return h(
          "tr",
          {
            title: "category confidence " + fixed(categoryConfidence) + " · priority confidence " + fixed(profile.reviewPriorityConfidence),
          },
          h(
            "td",
            { class: "profile-file" },
            h("code", { title: profile.file }, h("span", { class: "dir" }, dir), h("span", { class: "base" }, base)),
          ),
          h("td", { class: "profile-type" }, String(category)),
          h("td", { class: "profile-priority" }, severityMeter(profile.reviewPriority)),
        );
      }),
    ),
  );

  return section(
    "Files selected for closer review",
    h("span", { class: "count" }, list.length),
    h(
      "p",
      { class: "section-note" },
      "These files had the highest screening scores. The category summarizes the file or change; review priority runs from 0 (routine) to 3 (specialist attention).",
    ),
    h("div", { class: "profiles-wrap" }, table),
  );
}

function matrix(report) {
  const dimensions = dimensionsFor(report);
  const rows = [...report.matrix].sort((a, b) => maxP(b, dimensions) - maxP(a, dimensions));
  const screeningNote = "Each cell is the estimated probability, from 0 to 1, that a file has that kind of concern. Darker cells mean higher probability; cells at or above " + THRESHOLD.toFixed(2) + " are flagged for deeper review. Screening is triage, not a confirmed finding.";

  const toggle = h(
    "button",
    {
      class: "toggle",
      type: "button",
      "aria-pressed": String(showValues),
      title: "Show the exact probability in every cell",
      onclick: () => {
        showValues = !showValues;
        render(lastState);
      },
    },
    "0.00",
  );

  const legend = h(
    "div",
    { class: "legend" },
    h("span", { class: "legend-end" }, "0"),
    h(
      "span",
      { class: "legend-ramp", role: "img", "aria-label": `Probability scale, threshold ${THRESHOLD}` },
      h("i", { class: "legend-tick", style: { left: `${THRESHOLD * 100}%` } }),
    ),
    h("span", { class: "legend-end" }, "1"),
    toggle,
  );

  if (rows.length === 0) {
    return section(
      "Risk screening by file",
      null,
      h("p", { class: "section-note" }, screeningNote),
      quiet("No source files screened"),
    );
  }

  const table = h(
    "table",
    { class: `matrix${showValues ? " show-values" : ""}` },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { scope: "col", class: "file-col" }, h("span", { class: "sr" }, "File")),
        dimensions.map(([key, label, short]) =>
          h(
            "th",
            { scope: "col", title: label },
            h("span", { class: "long" }, label),
            h("abbr", { class: "short", title: label }, short),
          ),
        ),
      ),
    ),
    h(
      "tbody",
      {},
      rows.map((row) => {
        const [dir, base] = splitPath(row.file);
        return h(
          "tr",
          {},
          h(
            "th",
            { scope: "row", class: "file", title: row.file },
            h("span", { class: "path" }, h("span", { class: "dir" }, dir), h("span", { class: "base" }, base)),
          ),
          dimensions.map(([key, label]) => {
            const p = row[key];
            if (!isNum(p)) return h("td", { class: "cell missing" }, h("span", { class: "v" }, "–"));
            const hot = p >= THRESHOLD;
            return h(
              "td",
              {
                class: `cell${hot ? " hot" : ""}${p >= 0.55 ? " deep" : ""}`,
                style: { "--fill": fill(p) },
                title: `${row.file}\n${label} ${fixed(p)}`,
              },
              h("span", { class: "v" }, fixed(p)),
            );
          }),
        );
      }),
    ),
  );

  return section(
    "Risk screening by file",
    legend,
    h("p", { class: "section-note" }, screeningNote),
    h("div", { class: "matrix-wrap" }, table),
  );
}

function maxP(row, dimensions) {
  return Math.max(0, ...dimensions.map(([key]) => (isNum(row[key]) ? row[key] : 0)));
}

function severityMeter(severity) {
  const segments = Array.from({ length: SEVERITY_MAX }, (_, i) => {
    const amount = isNum(severity) ? Math.min(1, Math.max(0, severity - i)) : 0;
    return h("i", { style: { "--amount": `${(amount * 100).toFixed(0)}%` } });
  });
  return h(
    "span",
    { class: "severity" },
    h("span", { class: "meter", "aria-hidden": "true" }, segments),
    h("span", { class: "num" }, fixed(severity, 1)),
  );
}

function usage(report) {
  const data = report.usage;
  if (!data) return null;
  const tokens = data.tokensObserved
    ? `${data.inputTokens ?? "?"} in / ${data.outputTokens ?? "?"} out`
    : `${data.inputChars} chars (tokens not reported)`;
  const rows = Array.isArray(data.byStep) ? data.byStep : [];
  return section(
    "Jev usage",
    h("span", { class: "count" }, String(data.requests ?? 0)),
    h(
      "p",
      { class: "section-note" },
      "Per-request token counts when the API reports them. " +
        (data.model ? "Model " + data.model + ". " : "") +
        tokens +
        ", " +
        ((data.durationMs ?? 0) / 1000).toFixed(1) +
        "s. Estimated Jev cost " +
        formatUsd(jevCost(data)) +
        " at " +
        formatUsd(history.pricing?.inputUsdPerMtok ?? 0.042) +
        " per 1M input tokens; output is free.",
    ),
    rows.length > 0 &&
      h(
        "table",
        { class: "findings" },
        h("thead", {}, h("tr", {}, ["Step", "Requests", "In", "Out", "ms"].map((label) => h("th", { scope: "col" }, label)))),
        h(
          "tbody",
          {},
          rows.map((row) =>
            h(
              "tr",
              {},
              h("td", {}, row.step),
              h("td", {}, String(row.requests)),
              h("td", {}, row.inputTokens == null ? "–" : String(row.inputTokens)),
              h("td", {}, row.outputTokens == null ? "–" : String(row.outputTokens)),
              h("td", {}, String(row.durationMs)),
            ),
          ),
        ),
      ),
  );
}

function writerHost() {
  try {
    return new URL(writer.baseUrl).host;
  } catch {
    return writer.baseUrl || "not configured";
  }
}

async function writeReviews() {
  if (writeBusy || !lastState?.report?.findings?.length) return;
  writeBusy = true;
  writeError = "";
  render(lastState);
  try {
    const res = await fetch("/api/writeups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: viewingRunId || lastState?.runId || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    if (Array.isArray(body.writeups)) writeups = body.writeups;
    if (!res.ok) writeError = body.error || "Write-up failed";
  } catch {
    writeError = "Dashboard could not reach the writer";
  } finally {
    writeBusy = false;
    render(lastState);
  }
}

function writeupCard(finding, labels) {
  const writeup = writeupFor(finding);
  if (!writeup) return null;
  const [dir, base] = splitPath(finding.file);
  return h(
    "article",
    { class: `writeup${writeup.discard ? " discarded" : ""}` },
    h(
      "header",
      { class: "writeup-head" },
      h(
        "code",
        {},
        h("span", { class: "dir" }, dir),
        h("span", { class: "base" }, base),
        h("span", { class: "line" }, ":" + (finding.line ?? "?")),
      ),
      h("span", { class: "writeup-dim" }, (labels[finding.dimension] ?? finding.dimension) + " · " + finding.mechanism),
      writeup.discard && h("span", { class: "writeup-flag" }, "Not a defect"),
    ),
    h("p", { class: "writeup-claim" }, writeup.claim),
    writeup.quote && h("pre", { class: "writeup-quote" }, writeup.quote),
    writeup.change && h("p", { class: "writeup-change" }, writeup.change),
    writeup.discard && writeup.reason && h("p", { class: "writeup-reason" }, writeup.reason),
  );
}

function findings(report) {
  const list = report.findings;
  const labels = Object.fromEntries(dimensionsFor(report).map(([key, label]) => [key, label]));
  const count = h("span", { class: "count" }, list.length);
  const findingsNote = "These concerns passed screening and were tied to a concrete source region and mechanism. Severity runs from 0 (no meaningful impact) to 3 (critical). Findings are review leads, not proof of a defect. Write reviews sends each finding plus its source region to a local OpenAI-compatible model.";

  if (list.length === 0) {
    const followed = report.followedSignals;
    const detail =
      followed > 0
        ? followed + " potential " + (followed === 1 ? "concern was" : "concerns were") + " investigated; none had enough evidence to become a finding"
        : "No screening probability reached the " + THRESHOLD.toFixed(2) + " follow-up threshold";
    return section(
      "Findings",
      count,
      h("p", { class: "section-note" }, findingsNote),
      quiet("No supported findings", detail),
    );
  }

  const table = h(
    "table",
    { class: "findings" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        ["Location", "Concern", "Severity", "Owner", "Action"].map((label) => h("th", { scope: "col" }, label)),
      ),
    ),
    h(
      "tbody",
      {},
      list.map((finding) => {
        const [dir, base] = splitPath(finding.file);
        const blocking = finding.action === "request_changes";
        return h(
          "tr",
          {
            title: `location confidence ${fixed(finding.locationConfidence)} · severity confidence ${fixed(finding.severityConfidence)}`,
          },
          h(
            "td",
            { class: "loc" },
            h(
              "code",
              { title: `${finding.file}:${finding.line}` },
              h("span", { class: "dir" }, dir),
              h("span", { class: "base" }, base),
              h("span", { class: "line" }, `:${finding.line ?? "?"}`),
            ),
          ),
          h(
            "td",
            { class: "dim" },
            h("span", {}, labels[finding.dimension] ?? String(finding.dimension)),
            finding.mechanism && h("small", {}, String(finding.mechanism)),
          ),
          h("td", { class: "sev" }, h("span", { class: "sr" }, "severity "), severityMeter(finding.severity)),
          h("td", { class: "owner" }, finding.owner ? String(finding.owner) : "–"),
          h(
            "td",
            { class: `act ${blocking ? "blocking" : "comment"}` },
            h("span", { class: "glyph", "aria-hidden": "true" }),
            blocking ? "Request changes" : finding.action === "comment" ? "Comment" : String(finding.action),
          ),
        );
      }),
    ),
  );

  const written = list.map((finding) => writeupCard(finding, labels)).filter(Boolean);

  return section(
    "Findings",
    count,
    h("p", { class: "section-note" }, findingsNote),
    h(
      "div",
      { class: "write-bar" },
      h(
        "button",
        {
          class: "write-btn",
          type: "button",
          disabled: writeBusy,
          onclick: writeReviews,
        },
        writeBusy ? "Writing reviews…" : "Write reviews",
      ),
      h("span", { class: "write-meta" }, writer.model ? writer.model + " at " + writerHost() : "Set WRITE_BASE_URL and WRITE_MODEL"),
      writeError && h("span", { class: "write-error" }, writeError),
    ),
    table,
    written.length > 0 && h("div", { class: "writeups" }, written),
  );
}

function launchFields() {
  return {
    scope: document.getElementById("launch-scope"),
    pack: document.getElementById("launch-pack"),
    limit: document.getElementById("launch-limit"),
    files: document.getElementById("launch-files"),
    write: document.getElementById("launch-write"),
    shard: document.getElementById("launch-shard"),
    run: document.getElementById("launch-run"),
    meta: document.getElementById("launch-meta"),
    error: document.getElementById("launch-error"),
    log: document.getElementById("launch-log"),
    recents: document.getElementById("launch-recents"),
    browse: document.getElementById("launch-browse"),
  };
}

function readLaunch() {
  const fields = launchFields();
  return {
    scope: fields.scope?.value.trim() ?? "",
    pack: fields.pack?.value ?? "core",
    limit: fields.limit?.value ? Number(fields.limit.value) : undefined,
    files: fields.files?.value.trim() ?? "",
    write: Boolean(fields.write?.checked),
    allowShard: Boolean(fields.shard?.checked),
  };
}

function persistLaunch() {
  try {
    localStorage.setItem("jev-launch", JSON.stringify(readLaunch()));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function restoreLaunch() {
  const fields = launchFields();
  if (!fields.scope) return;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("jev-launch") || "null");
  } catch {
    saved = null;
  }
  if (saved && typeof saved === "object") {
    if (saved.scope) fields.scope.value = saved.scope;
    if (saved.pack) fields.pack.value = saved.pack;
    if (saved.limit) fields.limit.value = String(saved.limit);
    if (saved.files) fields.files.value = saved.files;
    fields.write.checked = saved.write !== false;
    fields.shard.checked = Boolean(saved.allowShard);
  }
  if (!fields.scope.value) {
    fields.scope.value = history.recents[0] || history.workspace || "";
  }
}

async function toggleBrowse() {
  browseOpen = !browseOpen;
  if (browseOpen) {
    const path = launchFields().scope?.value.trim() || history.workspace;
    await loadBrowse(path);
  }
  refreshLaunch();
}

async function loadBrowse(path) {
  try {
    const res = await fetch("/api/browse?path=" + encodeURIComponent(path || history.workspace || ""), {
      cache: "no-store",
    });
    browseState = res.ok ? await res.json() : { error: "Could not list that folder" };
  } catch {
    browseState = { error: "Could not list that folder" };
  }
  refreshLaunch();
}

function useBrowsePath(path, file) {
  const fields = launchFields();
  if (!fields.scope) return;
  fields.scope.value = path;
  if (file && fields.files && !fields.files.value.split(",").map((part) => part.trim()).includes(file)) {
    fields.files.value = fields.files.value ? fields.files.value + ", " + file : file;
  }
  persistLaunch();
  refreshLaunch();
}

async function startRun() {
  persistLaunch();
  launchError = "";
  const body = readLaunch();
  refreshLaunch();
  try {
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: body.scope,
        pack: body.pack,
        limit: body.allowShard ? body.limit : body.limit || 2,
        files: body.files,
        write: body.write,
        allowShard: body.allowShard,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (Array.isArray(data.runs)) history = { ...history, ...data };
    if (!res.ok) launchError = data.error || "Review failed to start";
    else viewingRunId = "";
  } catch {
    launchError = "Dashboard could not start the review";
  }
  load();
}

function renderBrowse() {
  const root = launchFields().browse;
  if (!root) return;
  root.hidden = !browseOpen;
  if (!browseOpen) return;
  if (!browseState || browseState.error) {
    root.replaceChildren(h("p", { class: "write-error" }, browseState?.error || "Choose a folder"));
    return;
  }
  root.replaceChildren(
    h(
      "div",
      { class: "browse-head" },
      h("code", { class: "browse-path", title: browseState.path }, browseState.path),
      h(
        "button",
        {
          type: "button",
          class: "ghost-btn",
          onclick: () => useBrowsePath(browseState.path),
        },
        "Use this folder",
      ),
    ),
    h(
      "ul",
      { class: "browse-list" },
      browseState.parent &&
        h(
          "li",
          {},
          h(
            "button",
            { type: "button", class: "browse-link", onclick: () => loadBrowse(browseState.parent) },
            "..",
          ),
        ),
      (browseState.entries || []).map((entry) =>
        h(
          "li",
          {},
          h(
            "button",
            {
              type: "button",
              class: "browse-link",
              onclick: () => {
                if (entry.kind === "dir") return loadBrowse(entry.path);
                const cut = entry.path.lastIndexOf("/");
                useBrowsePath(entry.path.slice(0, cut), entry.name);
              },
            },
            entry.kind === "dir" ? entry.name + "/" : entry.name,
          ),
        ),
      ),
    ),
  );
}

function refreshLaunch() {
  const fields = launchFields();
  if (!fields.run) return;
  const busy = Boolean(history.active);
  fields.run.disabled = busy;
  fields.run.textContent = busy
    ? history.active.status === "writing"
      ? "Writing reviews…"
      : "Running Jev…"
    : "Run Jev review";
  const writer = writerHost();
  fields.meta.textContent = history.hasKey
    ? (writer ? "Local write-up at " + writer : "Set WRITE_BASE_URL") +
      " · " +
      formatUsd(history.pricing?.inputUsdPerMtok) +
      " / 1M Jev input tokens"
    : "Set JEV_API_KEY in this fork's .env";
  fields.error.textContent = launchError;
  const logs = history.active?.logs ?? [];
  fields.log.hidden = logs.length === 0;
  fields.log.textContent = logs.slice(-12).join("\n");
  fields.recents.replaceChildren(
    ...(history.recents || []).map((path) =>
      h(
        "button",
        {
          type: "button",
          class: "recent",
          title: path,
          onclick: () => {
            fields.scope.value = path;
            persistLaunch();
          },
        },
        path.split("/").filter(Boolean).pop() || path,
      ),
    ),
  );
  renderBrowse();
}

function mountLaunch() {
  if (!launchRoot) return;
  if (launchMounted) {
    refreshLaunch();
    return;
  }
  launchRoot.replaceChildren(
    h(
      "div",
      { class: "launch" },
      h("h2", { class: "launch-title" }, "New review"),
      h(
        "p",
        { class: "section-note" },
        "Pick a folder, keep the file cap small, then run Jev. After the scores land, the local model can write the review notes. Every run is stored in a local SQLite database so a later pass on the same files can show whether the scores improved.",
      ),
      h(
        "label",
        { class: "field" },
        h("span", {}, "Folder"),
        h(
          "div",
          { class: "field-row" },
          h("input", {
            id: "launch-scope",
            type: "text",
            spellcheck: "false",
            autocomplete: "off",
            placeholder: "/path/to/folder",
            onchange: persistLaunch,
          }),
          h("button", { type: "button", class: "ghost-btn", onclick: toggleBrowse }, "Browse"),
        ),
      ),
      h("div", { id: "launch-recents", class: "recents" }),
      h("div", { id: "launch-browse", class: "browse", hidden: true }),
      h(
        "div",
        { class: "field-grid" },
        h(
          "label",
          { class: "field" },
          h("span", {}, "Pack"),
          h(
            "select",
            { id: "launch-pack", onchange: persistLaunch },
            h("option", { value: "core", selected: true }, "core"),
            h("option", { value: "contracts" }, "contracts"),
            h("option", { value: "structure" }, "structure"),
            h("option", { value: "product" }, "product"),
          ),
        ),
        h(
          "label",
          { class: "field" },
          h("span", {}, "Limit"),
          h("input", { id: "launch-limit", type: "number", min: "1", value: "2", onchange: persistLaunch }),
        ),
        h(
          "label",
          { class: "field wide" },
          h("span", {}, "Files"),
          h("input", {
            id: "launch-files",
            type: "text",
            spellcheck: "false",
            autocomplete: "off",
            placeholder: "contacts.ts, google-sheets.ts",
            onchange: persistLaunch,
          }),
        ),
      ),
      h(
        "div",
        { class: "launch-opts" },
        h(
          "label",
          { class: "check" },
          h("input", { id: "launch-write", type: "checkbox", checked: true, onchange: persistLaunch }),
          "Write reviews with the local model after Jev",
        ),
        h(
          "label",
          { class: "check" },
          h("input", { id: "launch-shard", type: "checkbox", onchange: persistLaunch }),
          "Allow a full folder scan",
        ),
      ),
      h(
        "div",
        { class: "write-bar" },
        h("button", { id: "launch-run", class: "write-btn", type: "button", onclick: startRun }, "Run Jev review"),
        h("span", { id: "launch-meta", class: "write-meta" }),
        h("span", { id: "launch-error", class: "write-error" }),
      ),
      h("pre", { id: "launch-log", class: "launch-log", hidden: true }),
    ),
  );
  launchMounted = true;
  restoreLaunch();
  refreshLaunch();
}

function historyPanel() {
  const runs = history.runs ?? [];
  if (runs.length === 0 && !history.totals?.runs) return null;
  const rows = runs.map((run) => {
    const name = run.scope.split("/").filter(Boolean).pop() || run.scope;
    const files = (run.files || []).map((file) => file.split("/").pop()).join(", ");
    const compare = run.compare
      ? [deltaText(run.compare.findingsDelta, "findings"), deltaText(run.compare.requestChangesDelta, "request changes")]
          .filter(Boolean)
          .join(" · ")
      : "first pass";
    const selected = (viewingRunId || history.currentRunId) === run.id;
    return h(
      "tr",
      {
        class: selected ? "history-row selected" : "history-row",
        onclick: () => {
          viewingRunId = run.id;
          load();
        },
      },
      h(
        "td",
        { class: "history-scope", title: run.scope },
        h("strong", {}, name),
        files && h("small", {}, files),
      ),
      h("td", {}, ago(run.createdAt)),
      h("td", {}, isNum(run.findings) ? String(run.findings) : run.status),
      h("td", {}, formatUsd(run.estimatedUsd)),
      h("td", { class: run.compare && run.compare.findingsDelta < 0 ? "improved" : "" }, compare),
    );
  });

  return section(
    "Run history",
    h("span", { class: "count" }, formatUsd(history.totals?.estimatedUsd) + " Jev · " + (history.totals?.runs ?? 0)),
    h(
      "p",
      { class: "section-note" },
      "SQLite keeps every scan, its Jev token counts, and the estimated cost. A later run of the same folder and files shows how findings moved after you change the code. Negative deltas are an improvement.",
    ),
    h(
      "div",
      { class: "profiles-wrap" },
      h(
        "table",
        { class: "history" },
        h(
          "thead",
          {},
          h("tr", {}, ["Scope", "When", "Findings", "Jev cost", "Vs previous"].map((label) => h("th", { scope: "col" }, label))),
        ),
        h("tbody", {}, rows),
      ),
    ),
  );
}

function viewingBanner(state) {
  if (!state?.historical) return null;
  return h(
    "div",
    { class: "banner" },
    "Showing an earlier run. Scores here stay put so you can compare them after a later pass.",
    h(
      "button",
      {
        type: "button",
        class: "ghost-btn",
        onclick: () => {
          viewingRunId = history.currentRunId || "";
          load();
        },
      },
      "Show latest",
    ),
  );
}

function renderMeta(state) {
  meta.replaceChildren();
  if (state?.status !== "ok") return;
  const scope = state.report.scope;
  const name = scope.split("/").filter(Boolean).pop() ?? scope;
  const mode = state.report.mode === "codebase" ? "Codebase scan" : "Change review";
  const profile = state.report.config?.profile;
  const packs = Array.isArray(state.report.config?.packs) ? state.report.config.packs.join("+") : null;
  meta.append(
    h("span", { class: "mode", title: mode }, mode),
    profile && h("span", { class: "sep", "aria-hidden": "true" }, "·"),
    profile && h("span", { title: "profile " + profile + (packs ? " packs " + packs : "") }, [profile, packs].filter(Boolean).join(" / ")),
    h("span", { class: "sep", "aria-hidden": "true" }, "·"),
    h("span", { class: "scope", title: scope }, name),
    h("span", { class: "sep", "aria-hidden": "true" }, "·"),
    h("time", { datetime: state.savedAt, title: new Date(state.savedAt).toLocaleString() }, ago(state.savedAt)),
  );
}

function render(state) {
  lastState = state;
  mountLaunch();
  renderMeta(state);
  document.body.dataset.status = state?.status ?? "offline";
  const chrome = [viewingBanner(state), historyPanel()].filter(Boolean);

  switch (state?.status) {
    case "ok":
      app.replaceChildren(
        ...chrome,
        ...[
          summary(state.report),
          workflow(state.report),
          usage(state.report),
          profiles(state.report),
          matrix(state.report),
          findings(state.report),
        ].filter(Boolean),
      );
      break;
    case "empty":
      app.replaceChildren(...chrome, quiet("No review yet", "Use the form above, or:", "npm run review:codebase:save -- <path> --pack core --limit 2"));
      break;
    case "error":
      app.replaceChildren(...chrome, quiet("Unreadable report", `${state.message} · ${state.source}`));
      break;
    default:
      app.replaceChildren(...chrome, quiet("Server unavailable", null, "npm run dashboard"));
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (history.active || writeBusy) pollTimer = setTimeout(load, 1200);
}

async function load() {
  let state;
  const reviewUrl = viewingRunId ? "/api/review?runId=" + encodeURIComponent(viewingRunId) : "/api/review";
  try {
    const res = await fetch(reviewUrl, { cache: "no-store" });
    state = res.ok ? await res.json() : { status: "offline" };
    if (res.status === 404 && viewingRunId) {
      viewingRunId = "";
      return load();
    }
  } catch {
    state = { status: "offline" };
  }
  try {
    const [writeRes, writerRes, runsRes] = await Promise.all([
      fetch("/api/writeups" + (viewingRunId ? "?runId=" + encodeURIComponent(viewingRunId) : ""), { cache: "no-store" }),
      fetch("/api/writer", { cache: "no-store" }),
      fetch("/api/runs", { cache: "no-store" }),
    ]);
    if (writeRes.ok) {
      const body = await writeRes.json();
      if (Array.isArray(body.writeups)) writeups = body.writeups;
    }
    if (writerRes.ok) writer = await writerRes.json();
    if (runsRes.ok) history = { ...history, ...(await runsRes.json()) };
    const newest = history.runs?.[0];
    if (!launchError && !history.active && newest?.status === "error" && newest.error) {
      launchError = newest.error;
    }
  } catch {
    // Keep last write-ups if the extra endpoints are down.
  }
  if (Array.isArray(state.writeups)) writeups = state.writeups;
  if (state.writeError && !writeError) writeError = state.writeError;
  const key = JSON.stringify({
    state,
    writeups,
    writer,
    writeBusy,
    writeError,
    launchError,
    viewingRunId,
    history,
  });
  if (key === lastKey) {
    renderMeta(state);
    refreshLaunch();
    schedulePoll();
    return;
  }
  lastKey = key;
  render(state);
  schedulePoll();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load();
});
window.addEventListener("focus", load);
load();
