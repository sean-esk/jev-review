# Jev Review

A small code-review workflow built with [TypeSafe Jev](https://typesafe.ai). It can review a Git diff or scan a complete codebase, follows the strongest structured signals through focused model calls, and presents the result in a quiet local dashboard.

Jev only scores. A local OpenAI-compatible model (Ollama or LM Studio) writes the review notes. Every run — scores, token counts, and estimated Jev cost — is stored in a local SQLite database so a later pass on the same files can show whether the scores improved.

![Jev Review dashboard](docs/dashboard.png)

## Set this up on a new Mac (including the Mac Studio)

Do this in order. When you are done, `npm run dashboard` is enough.

### 1. Put the repo next to the monorepo

This fork is **not** part of `LM-Apps-Monorepo`. Clone the `level-method` branch as a sibling:

```bash
cd /Users/sean/Software/LevelMethod
git clone -b level-method https://github.com/sean-esk/jev-review.git
cd jev-review
```

You should have:

```text
/Users/sean/Software/LevelMethod/LM-Apps-Monorepo   # the product
/Users/sean/Software/LevelMethod/jev-review         # this tool
```

If the Studio already has the clone, pull this branch:

```bash
cd /Users/sean/Software/LevelMethod/jev-review
git checkout level-method
git pull origin level-method
```

### 2. Node.js 24

`package.json` requires Node 24+. Homebrew:

```bash
brew install node@24
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
node -v    # v24.x
```

Put that `export` in `~/.zprofile` so new terminals keep it.

```bash
npm install
```

### 3. Create `.env` in this repo

The key and the local-model URL live in **`jev-review/.env`**. The monorepo `.env` is not read automatically.

```bash
cd /Users/sean/Software/LevelMethod/jev-review
cp .env.example .env
```

`.env` is gitignored. Never commit it. Never paste the key into chat, docs, or the dashboard.

`npm run dashboard` and the review commands load that file with Node's `--env-file=.env`. If `.env` is missing or in the wrong directory, Jev has no key and the writer has no URL.

### 4. Put the Jev API key in `.env`

Jev is the paid TypeSafe scorer. Either variable name works:

| Variable | Where it comes from |
| --- | --- |
| `JEV_API_KEY` | Already in `LM-Apps-Monorepo/.env` on the machines that have been running this |
| `TYPESAFE_API_KEY` | A key you create at [TypeSafe API keys](https://console.typesafe.ai/settings/keys) |

Fastest path on the Studio: open `../LM-Apps-Monorepo/.env`, copy the `JEV_API_KEY=...` line, and paste it into `jev-review/.env`. Leave `TYPESAFE_API_KEY` blank if you use `JEV_API_KEY`.

The dashboard aliases `JEV_API_KEY` to `TYPESAFE_API_KEY` at startup. You should see no "No TypeSafe/Jev API key" error when you run a review.

### 5. Point the writer at the local model

After Jev scores a finding, the dashboard POSTs JSON to an OpenAI-compatible chat API:

```text
POST {WRITE_BASE_URL}/chat/completions
```

`WRITE_BASE_URL` should end in `/v1` (the tool appends `/chat/completions`). Set both the URL and the exact model name in `.env`.

**Ollama on this Mac (the default, and what the Studio should use):**

```bash
# .env
WRITE_BASE_URL=http://127.0.0.1:11434/v1
WRITE_MODEL=qwen3.8
```

```bash
# confirm Ollama is up and the model name matches WRITE_MODEL
curl -sS http://127.0.0.1:11434/v1/models
ollama list
ollama pull qwen3.8    # only if that name is missing
```

**LM Studio on this Mac:** start the local server, then:

```bash
# .env
WRITE_BASE_URL=http://127.0.0.1:1234/v1
WRITE_MODEL=the-exact-name-shown-in-lm-studio
```

**Dashboard on one Mac, model on the Studio:** `127.0.0.1` is the machine running the dashboard, not the Studio. Use the Studio LAN address instead:

```bash
WRITE_BASE_URL=http://192.168.x.x:11434/v1
WRITE_MODEL=qwen3.8
```

`WRITE_API_KEY` is optional. Local servers usually ignore it; the client sends `local` when it is empty. `OPENAI_BASE_URL`, `OPENAI_MODEL`, and `OPENAI_API_KEY` are accepted as aliases if you already use those names.

### 6. Point Browse at the monorepo (optional)

If `jev-review` sits next to `LM-Apps-Monorepo`, Browse already opens that sibling. To force it:

```bash
# .env
JEV_WORKSPACE=/Users/sean/Software/LevelMethod/LM-Apps-Monorepo
```

### 7. Start the dashboard

```bash
cd /Users/sean/Software/LevelMethod/jev-review
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"   # if node -v is not 24
npm run dashboard
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317). The process should print something like:

```text
Jev review dashboard: http://127.0.0.1:4317
report: reviews/latest.json
history: reviews/runs.sqlite (N runs, $0.00xx)
writer: qwen3.8 @ http://127.0.0.1:11434/v1
```

On the page, **Run Jev review** should show `Local write-up at 127.0.0.1:11434` (or your LM Studio host) and `$0.042 / 1M Jev input tokens`. If it says the key is missing, `.env` is in the wrong place or the variable is empty. If a write-up fails with `No local model at .../chat/completions`, the URL is wrong or Ollama/LM Studio is not running.

### 8. Run a review from the page

1. **Folder** — paste a small path, or **Browse**. Recents appear under the field.
2. **Pack** — `core` for the cheap smoke.
3. **Limit** — keep this small (default `2`). Name **Files** when you can (`contacts.ts`).
4. Leave **Write reviews with the local model after Jev** checked so scoring and write-up happen in one pass.
5. Do **not** check **Allow a full folder scan** until a small pass is cheap.
6. **Run Jev review**. The monorepo root and unbounded folders are refused.

History, tokens, and estimated Jev cost land in `reviews/runs.sqlite` (gitignored). The latest report is also mirrored to `reviews/latest.json`. A later run of the same folder and files shows whether findings went down after you change the code.

CLI is optional once the dashboard is up. Same `.env`, same database:

```bash
npm run review:codebase:save -- /Users/sean/Software/LevelMethod/LM-Apps-Monorepo/backend/src/api \
  --pack core --limit 1 --files contacts.ts
```

## How It Works

The reviewer keeps orchestration in code and uses Jev for bounded judgments:

```text
Noul risk matrix
  -> Choice + Score file profiles
  -> Choice evidence selection
  -> Choice mechanism classification
  -> Score severity
  -> conditional Choice reviewer routing
  -> local model writes claim / quote / change
```

- Exposes separate change-review and complete-codebase entry points.
- Uses changed or related tests as context when judging test gaps.
- Screens correctness, security, reliability, compatibility, and test coverage.
- Selects concrete diff hunks or source regions before scoring impact.
- Applies thresholds and workflow policy in code.
- Binds the dashboard to `127.0.0.1` and never serves `.env` or other environment files.

Published Jev 1.13 price used for history: **$0.042 per 1M input tokens, output free**. Override with `JEV_INPUT_USD_PER_MTOK` / `JEV_OUTPUT_USD_PER_MTOK` only if that rate changes.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dashboard` | Local dashboard at [http://127.0.0.1:4317](http://127.0.0.1:4317) |
| `npm run review:codebase:save -- <path> --pack core --limit 2` | Save a shard/file scan (also writes SQLite history) |
| `npm run review:codebase -- <path> --pack core --limit 2` | Print a shard/file scan as JSON |
| `npm run review:changes:save -- <path>` | Save a merge-base or worktree diff review |
| `npm run review:changes -- <path> [--base origin/staging]` | Print a change review as JSON |
| `npm run check` | Typecheck, dependency flow, SQLite smoke, dashboard syntax |

`--profile level-method` is the default on this branch. `--pack` selects `core`, `contracts`, `structure`, and/or `product`. `--files` and `--limit` keep a run to a handful of files. The monorepo root is refused. A workspace member with more than six source files also needs `--limit` / `--files` or `--allow-shard`.

## Architecture

Everything lives under `src/`, arranged in layers that only depend downward:

```text
src/
  domain/      config.ts, types.ts, patch.ts   shared policy, report shapes, diff parsing
  adapters/    git.ts, repository-files.ts     change and complete-source discovery
               report-store.ts                 atomic report save/load
               run-store.ts                    SQLite run history, tokens, Jev cost
               writeup-store.ts, openai-writer.ts
                                               local OpenAI-compatible write-ups
  review/      changes.ts, codebase.ts, launch.ts
                                               mode-specific workflows and dashboard launch
               *-judgments.ts, workflow.ts     Jev calls and shared staged orchestration
  cli/         review-*.ts, save-*.ts           explicit mode entry points
  dashboard/   server.ts, public/              local-only HTTP server and the plain client
```

Imports point toward lower layers only:

```text
{ cli, dashboard } -> review -> adapters -> domain
```

`scripts/check-dependencies.ts` fails `npm run check` on any upward import, any
import between `cli` and `dashboard`, or any cycle.

## Current Scope

This is an experiment in composing fast typed judgments into a review workflow. It does not yet integrate compiler diagnostics, static analyzers, or repository indexing. Findings are review prompts, not proof of a defect.

## License

[MIT](LICENSE)
