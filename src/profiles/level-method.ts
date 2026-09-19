// Level Method pack catalog. Extra dimensions, mechanisms, owners, and
// LM-flavored examples for the stock five screens. Criteria come from the
// auth-shard brief and LM pack examples — not a second product.
import { changeTypes, fileRoles, owners } from "../domain/config.ts";
import type { DimensionScreen, PackName } from "../domain/policy.ts";
import { alwaysCore, uniquePacks } from "../domain/policy.ts";
import { coreScreens, withExamples } from "../domain/screens.ts";

const lmCore = coreScreens.map((screen) => {
  switch (screen.key) {
    case "correctness":
      return withExamples(screen, {
        mechanisms: {
          legacyPort: "Ported an endpoint or helper but not the page-level join, gate, or return",
        },
        changeTrue: [
          "session.role < X without return after Unauthorized",
          "undefined < Coach treated as authorized",
          "joining list pages on email instead of _id",
        ],
        codebaseTrue: [
          "if (session.role < Roles.Coach) { res.send(Unauthorized) } with no return",
          "status token ignored so siteAdmin/owner is inherited from roles[]",
          "coach numeric role 20/30/35 not accepted by a string-only hasRole copy",
        ],
        changeFocus: "Inverted role checks, missing return after deny, wrong join key, encode inventing a number",
        codebaseFocus: "Inverted role checks, missing return after deny, wrong join key, encode inventing a number",
      });
    case "security":
      return withExamples(screen, {
        mechanisms: {
          publicEndpoint: "PUBLIC_ENDPOINTS / allowlist change without a security note",
        },
        changeTrue: [
          "isSiteAdminOwner treating 40 as owner",
          "Bearer or body access_token on AUTH_ENDPOINTS",
          "new dangerouslySetInnerHTML outside the two sanctioned sinks",
        ],
        codebaseTrue: [
          "isSiteAdminOwner is not 45 or 50 only",
          "Impossible sentinel 60 treated as a grant",
          "token persisted after lm-cookie-boot-ok is set (unless this is the intended gym partialize scrub)",
        ],
        changeFocus: "45/50 vs 40, AUTH_ENDPOINTS injection, sanctioned XSS sinks only",
        codebaseFocus: "45/50 vs 40, AUTH_ENDPOINTS injection, sanctioned XSS sinks only",
      });
    case "reliability":
      return withExamples(screen, {
        mechanisms: {
          strictModeBoot: "Run-once boot stored on a module promise that StrictMode can cancel forever",
        },
        changeTrue: [
          "POST /access-token rotation racing parallel child queries into a 401 logout",
          "failed 5xx/drift promise cached so retry cannot recover (RF-026)",
          "memory-only session without BroadcastChannel (RF-027)",
        ],
        codebaseTrue: [
          "createSessionBoot in-flight cache not cleared after transient failure",
          "boot effect uses a module-level promise the remount cannot replace",
          "MCP tool fires the backend before args.confirm === true",
        ],
        changeFocus: "Boot rotation races, failed-promise cache, BroadcastChannel vs storage, confirmation gates",
        codebaseFocus: "Boot rotation races, failed-promise cache, BroadcastChannel vs storage, confirmation gates",
      });
    case "compatibility":
      return withExamples(screen, {
        changeFocus: "Observable caller breakage only — schema disagreement is the contracts dimension",
        codebaseFocus: "Observable caller breakage only — schema disagreement is the contracts dimension",
        changeTrue: ["login envelope drops sessionId that switch-organization callers still send"],
        codebaseTrue: ["exported type promises access_token while runtime prefers a rotated token and omits it"],
      });
    case "testGap":
      return withExamples(screen, {
        mechanisms: {
          silentSuite: "Package test script is a no-op and no app Vitest glob runs the files",
        },
        changeTrue: ["new package tests were not added to an app Vitest glob"],
        codebaseTrue: [
          "package.json test is echo && exit 0 and no gym/coach/site-admin glob includes this tree",
          "authorization behavior lacks a denial test for 40 vs 45/50",
        ],
        changeFocus: "Silent suites and missing denial tests, not filename mismatch alone",
        codebaseFocus: "Silent suites and missing denial tests, not filename mismatch alone",
      });
    default:
      return screen;
  }
});

function extra(
  key: string,
  label: string,
  short: string,
  definition: string,
  mechanisms: Record<string, string>,
  focus: string,
  yes: string[],
  no: string[],
): DimensionScreen {
  const instructions = {
    question: `Does the evidence directly support ${definition.slice(0, 1).toLowerCase()}${definition.slice(1)}`,
    focus,
    ignore: ["Style the lint/tiers/endpoints gates already own", "Neighbors named only as context"],
  };
  const criteria = {
    true: { what: definition, examples: yes },
    false: {
      what: "No concrete disagreement or leak is supported in this file",
      examples: no,
      not_for: "Guesses about files that are only named as neighbors",
    },
  };
  return {
    key,
    label,
    short,
    definition,
    mechanisms: { ...mechanisms, noIssue: "The selected evidence does not support this concern" },
    change: { instructions: { ...instructions, inspect: "file.patch" }, criteria },
    codebase: { instructions: { ...instructions, inspect: "file.content" }, criteria },
  };
}

const contractsScreens: DimensionScreen[] = [
  extra(
    "dataHandling",
    "Data handling",
    "Data",
    "Values are wrong or incompletely modeled at a boundary.",
    {
      nullVsMissing: "field?: string vs wire null under exactOptionalPropertyTypes",
      legacyDomain: "Fixtures or types miss migrated/legacy accounts (relayEmail)",
      wireCase: "Invented camelCase instead of LM Node wire names (firstname, organization)",
      persistAllowlist: "Zustand partialize silently drops a new field, or persists a token after cookie-boot",
      clientJoin: "Two endpoints joined unlike the legacy container (usually _id)",
    },
    "Wire vs model vs persist allow-lists. Token omitted after cookie-boot is intended in gym.",
    [
      "relayEmail Boolean in mongoose vs null/string on legacy docs",
      "partialize deny-list dropping a new session field",
      "join on email instead of _id",
    ],
    ["gym partialize omitting token once lm-cookie-boot-ok is set", "documented optional access_token after rotate"],
  ),
  extra(
    "apiSurface",
    "API surface",
    "API",
    "How the app is allowed to talk to LM Node is violated.",
    {
      rawClient: "fetch / extra axios instead of apiClient",
      allowlistDrift: "Call site vs endpoints.ts vs pnpm endpoints",
      authInjection: "Session token on a credential-taking AUTH_ENDPOINT",
      queryKey: "Hand-rolled queryKey instead of @lm/query/keys",
      envelope: "HTTP 200 error body not passed through parse-api-response",
    },
    "apiClient, allowlists, AUTH/PUBLIC injection, query keys, envelopes.",
    [
      "Bearer on /login or /user/sendPasswordResetLink",
      "PUBLIC_ENDPOINTS entry that is not a subset of the app allowlist",
      "success:false treated as a thrown network error",
    ],
    [
      "coach has no getToken because it is cookie-only (D-08)",
      "site-admin withCredentials false and localStorage JWT (S-4, not a defect yet)",
      "allowlist findings in packages/auth — those lists live beside this shard",
    ],
  ),
  extra(
    "contracts",
    "Contracts",
    "Ctrct",
    "Two declared sources of truth disagree.",
    {
      zodVsModel: "*.zod.ts vs mongoose interface or Node role metadata",
      lockstep: "Documented twin tables/evaluators that diverged",
      scalingWire: "@lm/scaling-contracts vs services/scaling-engine",
      mcpCatalog: "Tool args / scopes vs the Node endpoint the app already calls",
      additiveBreak: "Required field added without a migration path",
    },
    "Disagreement between documents even if nobody has called yet. Caller breakage is compatibility.",
    [
      "UserRole / RoleLevel vs backend/src/security/roles.ts 40/45/50/60",
      "auth.zod.ts comment claiming /access-token returns only { success, userInfo }",
      "intake-model evaluator drifted from backend intake-condition.ts",
    ],
    ["a comment that is stale but runtime schema already matches session-boot"],
  ),
];

const structureScreens: DimensionScreen[] = [
  extra(
    "deadCode",
    "Dead code",
    "Dead",
    "Unused in realistic runtime, not merely unimported in one graph.",
    {
      unusedExport: "knip/depcruise hit that is not a public contract",
      unusedRoute: "Router or nav entry with no reachable page",
      deadConfig: "Allowlist or env key nothing reads",
      silentTest: "Suite that never runs",
      falsePositive: "Capacitor, MCP tool, Netlify prerender, or dynamic import — drop the finding",
    },
    "Realistic runtime reachability. knip.json is a stub; a hit is a candidate.",
    ["checkout path left in GYM_ENDPOINTS after Individual moved to public-site"],
    ["dynamic import, MCP tool, Capacitor native entry, public-site prerender skip"],
  ),
  extra(
    "legacy",
    "Legacy",
    "Leg",
    "Leftover dual paths after a port or extraction.",
    {
      fuseDual: "NextGen + LevelMethodReactSpa behavior still forked",
      wrongApp: "Site-admin work built in gym because isSiteAdmin was nearby",
      gymmie: "Gymmie/Jimmy names or assumptions",
      extractedLeftover: "Feature still in gym after public-site / package hoist",
      shallowAdapter: "Module that only forwards backend quirks to callers",
    },
    "Dual paths, wrong app, Gymmie leftovers, shallow adapters.",
    ["gymmie-sync still authoritative for a live path", "checkout still served from apps/gym"],
    ["a Fuse citation used only as historical scout notes"],
  ),
  extra(
    "architecture",
    "Architecture",
    "Arch",
    "Layering and ownership the gates do not fully see.",
    {
      featureImport: "Feature → feature import, including dynamic import()",
      deepImport: "packages/*/src reach-around",
      serverInZustand: "Server state in a Zustand store",
      secondOwner: "Two boot modules for the same concern (L-06)",
      fileSize: "Over 400/800 with no documented exception — advisory unless coupled to a bug",
    },
    "Feature imports, deep src reach-around, Zustand vs Query, second boot owners.",
    ["useCurrentUser and AuthProvider both POSTing /access-token", "import from packages/auth/src"],
    ["file length alone with no coupled defect"],
  ),
  extra(
    "isolation",
    "Isolation",
    "Iso",
    "Tier, bundle, or service boundary is crossed.",
    {
      tierLeak: "Admin string or package in a customer/public/coach graph",
      marketingChunk: "Application code in a public-site marketing preload",
      serviceBrain: "MCP or satellite computing product state locally",
      serviceMongo: "Service touching the database",
      hostMount: "Host importing a connector beyond ./app ./config ./scopes",
    },
    "Tiers, marketing chunks, MCP second brains, service Mongo, host mounts.",
    ["MCP presenter with a local belt/role table", "marketing preload importing api client"],
    ["year filter on list_programming_months that is presentation over Node data"],
  ),
];

const productScreens: DimensionScreen[] = [
  extra(
    "productConsistency",
    "Product consistency",
    "Prod",
    "The code violates a named Level Method product invariant.",
    {
      beltTaxonomy: "Green belt, or merging 8-belt MAP with 7-color programming, or Red as a programming prescription",
      roleWord: "Coach/Site Admin role vs app confused in UI, MCP, or comments that drive code",
      mbtFields: "Role / block_type / purpose / tag used as each other; purpose shown in UI",
      recoveryWords: "Renaming wire recovery keys to Restoration, or Cooldown picker labeled Restoration",
      weightUnits: "Per-map LB/KG override",
      encodeRules: "Cleanup/encode adding or dropping a number; local fallback when Node/engine should own state",
    },
    "Named product invariants only. Do not invent vocabulary from comments.",
    [
      "MAP BELT_ORDER including green, or programming colors including red",
      "purpose string rendered in UI",
      "typedLoad fabricating a number for an unclassified load",
    ],
    ["Coach role 20 vs Coach app mentioned correctly as distinct"],
  ),
];

export const lmOwners = {
  ...owners,
  auth: "Session boot, cookie capability, client role conclusions",
  contracts: "@lm/api-types / coach-api-types / lockstep twins",
  mbt: "MBT taxonomy, export, encode",
  scaling: "Scaling engine and scaling-contracts",
  mcp: "MCP services and mcp-kit",
  payments: "Stripe, checkout, subscriptions",
  belts: "MAP belts vs programming colors",
};

export const lmFileRoles = {
  ...fileRoles,
  contractSchema: "Zod, mongoose, or lockstep schema",
  queryHook: "TanStack Query hook or key registry",
  featurePage: "App feature route or page",
  mongooseModel: "Mongoose model or backend document type",
  migration: "Data or schema migration",
  mcpTool: "MCP tool, presenter, or confirmation gate",
  scalingTable: "Scaling engine table or vocabulary snapshot",
  gateScript: "Repo gate, allowlist, or hygiene script",
};

export const lmChangeTypes = {
  ...changeTypes,
  contract: "Changes a declared schema, lockstep pair, or wire contract",
  allowlist: "Changes endpoints, PUBLIC/AUTH lists, or gate allowlists",
  migration: "Migrates persisted data or required fields",
  port: "Ports behavior from Fuse/legacy into NextGen",
  gate: "Changes a merge-gate or CI-adjacent check",
};

export function screensForPack(pack: PackName): DimensionScreen[] {
  switch (pack) {
    case "core":
      return lmCore;
    case "contracts":
      return contractsScreens;
    case "structure":
      return structureScreens;
    case "product":
      return productScreens;
    default: {
      const _never: never = pack;
      throw new Error("Unknown pack: " + _never);
    }
  }
}

const CONTRACTS_HINT =
  /auth|api-client|api-types|backend|mcp|endpoints|zod|scaling-contracts|query/;
const PRODUCT_HINT = /mbt|belt|scaling|programming|intake-model|prescription/;

export function selectPacks(scope: string, explicit?: PackName[]): PackName[] {
  if (explicit && explicit.length > 0) return uniquePacks(explicit.includes("core") ? explicit : alwaysCore(explicit));
  const path = scope.replace(/\\/g, "/").toLowerCase();
  const packs: PackName[] = ["core"];
  if (CONTRACTS_HINT.test(path)) packs.push("contracts");
  if (PRODUCT_HINT.test(path)) packs.push("product");
  if (/(?:^|\/)services(?:\/|$)/.test(path)) packs.push("structure");
  return uniquePacks(packs);
}