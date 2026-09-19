// Compact Jev state for packages/auth. Sourced from the auth-shard brief.
// Neighbors are named, not scanned.

export const AUTH_RELATED_TEST_HINTS = [
  "packages/auth/",
  "apps/gym/src/shared/auth/",
  "packages/api-client/src/client.test.ts",
  "packages/api-client/src/endpoint-allowlist.test.ts",
  "packages/lm-api-types/src/user.test.ts",
  "backend/tests/security/",
];

export const authShardContext = {
  package: "@lm/auth",
  tier: "shared",
  owner: "auth",
  owns: [
    "role conclusions from wire fields",
    "lm-cookie-boot-ok capability flag",
    "/access-token boot-with-rotation (createSessionBoot)",
    "storage and rehydration helpers",
  ],
  doesNotOwn: [
    "wire shapes (packages/lm-api-types user.zod.ts / auth.zod.ts)",
    "Zustand create/persist/BroadcastChannel wiring (app stores)",
    "token injection, AUTH_ENDPOINTS, PUBLIC_ENDPOINTS (api-client + app client.ts)",
    "server authorization (backend/src/security) — client predicates are UI-only",
  ],
  sessionModel: [
    "HttpOnly cookie level-method2-session; cookie-only POST /access-token rotates (deletes old Session, new JWT)",
    "lm-cookie-boot-ok=1 is a non-secret capability flag; unset falls back to persist token under lm-auth",
    "probe cookie-first with credentialLess / lmAuthMode none so a probe 401 cannot clear the session",
    "flag set = memory-only tokens; authoritative 401/403 or success:false = signed out",
    "transient 5xx / network / schema drift (L-07) preserve session and must not cache the failed promise (RF-026)",
    "cross-tab: storage events while token persists; BroadcastChannel once memory-only (RF-027)",
    "token writes only through setSession; resetCookieBootFlagForTests is test-only",
  ],
  roles: [
    "numeric privilege is canonical on Node: Guest 0, Education 5, Member 10, Coach 20, Admin 30, Owner 35, SiteAdmin 40, SiteAdminOwner 45, Root 50, Impossible 60 never a grant",
    "isSiteAdminOwner is 45 or 50 only; generic siteAdmin 40 is not owner",
    "missing/undeclared role must not pass session.role < X (undefined < 20 is false)",
    "resolveRoles: invalid role_level → []; status scalars replace membership and must not inherit siteAdmin/owner/root from level",
    "root / siteAdminOwner strings without a level become siteAdmin only",
    "hasRole is the one predicate; gym uses strings, coach login mixes string|number 20/30/35/40/50",
  ],
  wordCollisions: [
    "Coach = gym staff role 20 or the Coach app (organization_type coaching) — unrelated",
    "Site Admin = apps/site-admin or role 40 in-place gym affordances; isSiteAdmin is not a license to build platform tooling in gym",
  ],
  intended: [
    "gym auth-store partialize omitting token once the cookie flag is set is the scrub, not persistAllowlist noise",
    "coach is cookie-only (no getToken); site-admin is localStorage jwt_access_token, no cookies — not-yet-converged (S-4), not a defect",
    "package test script is a documented no-op; suite is live via apps/gym/vitest.config.ts glob",
    "storage keys lm-auth, lm-cookie-boot-ok, channel lm-auth-session are not secrets",
  ],
  neighbors: [
    "PUBLIC_ENDPOINTS / AUTH_ENDPOINTS live beside this shard; mention only, do not invent allowlist findings here",
    "auth.zod.ts comment is stale: AccessTokenSuccessResponseSchema and session-boot treat access_token as optional and prefer the rotated token",
    "relayEmail Boolean vs null/string is in lm-api-types, not this package",
  ],
  firstPass: [
    "resolveRoles + isSiteAdminOwner vs 40/45/50/60",
    "in-flight boot promise vs rotation vs parallel queries / StrictMode",
    "RF-026 failed-promise cache clear and L-07 drift",
    "status tokens and coach numeric roles",
  ],
};

export const backendApiContext = {
  shard: "backend/src/api",
  testsLiveIn: "backend/tests — not beside the route file; 0 relatedTests under src/api is expected",
  testGap:
    "Do not request_changes for a missing colocated test. Tests live in backend/tests. Comment is the most testGap can do on this shard.",
  knownShape: [
    "contacts.ts: if (session.role < Roles.Coach) { res.send(Unauthorized) } with no return — classify as condition or asyncControl, never legacyPort; handler continues and can res.send success after Unauthorized",
    "google-sheets.ts / spa-version.ts: same deny then return — contrast, not a defect",
    "undefined < Roles.Coach is false, so a missing numeric role also skips the deny",
  ],
};

export function contextForScope(scope: string): typeof authShardContext | typeof backendApiContext | null {
  const path = scope.replace(/\\/g, "/");
  if (/packages\/auth(?:\/|$)/.test(path)) return authShardContext;
  if (/backend(?:\/|$)/.test(path)) return backendApiContext;
  return null;
}

export function testHintsForScope(scope: string): string[] {
  const path = scope.replace(/\\/g, "/");
  if (/packages\/auth(?:\/|$)/.test(path)) return AUTH_RELATED_TEST_HINTS;
  return [];
}