// Review policy: packs, budgets, and the resolved screen catalog a run uses.
// Profiles supply extra screens; this module is the shared shape.

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonPrimitive | JsonPrimitive[] | JsonObject | JsonObject[] };

export const PACKS = ["core", "contracts", "structure", "product"] as const;
export type PackName = (typeof PACKS)[number];

export const PROFILES = ["generic", "level-method"] as const;
export type ProfileName = (typeof PROFILES)[number];

export function isPackName(value: string): value is PackName {
  return (PACKS as readonly string[]).includes(value);
}

export function isProfileName(value: string): value is ProfileName {
  return (PROFILES as readonly string[]).includes(value);
}

export type OutcomeSpec = {
  what: string;
  examples?: string[];
  not_for?: string;
};

export type NoulInstructions = {
  question: string;
  inspect?: string;
  compare?: string[];
  focus: string;
  ignore?: string[];
  caution?: string;
};

export type DimensionScreen = {
  key: string;
  label: string;
  short: string;
  definition: string;
  mechanisms: Record<string, string>;
  change: { instructions: NoulInstructions; criteria: { true: OutcomeSpec; false: OutcomeSpec } };
  codebase: { instructions: NoulInstructions; criteria: { true: OutcomeSpec; false: OutcomeSpec } };
};

export type ReviewPolicy = {
  profile: ProfileName;
  packs: PackName[];
  sourceFile: RegExp;
  ignorePath: RegExp;
  screens: DimensionScreen[];
  owners: Record<string, string>;
  fileRoles: Record<string, string>;
  changeTypes: Record<string, string>;
  defaultBase: string | null;
  context: JsonObject | null;
  relatedTestHints: string[];
};

export type ReviewRequest = {
  scope: string;
  policy: ReviewPolicy;
  base?: string;
  mergeBaseSha?: string;
  headSha?: string;
  limit?: number;
  files?: string[];
  maxFollowUps?: number;
  maxProfiles?: number;
  allowShard?: boolean;
  mapLmr?: boolean;
};

export function followUpBudget(fileCount: number, override?: number): number {
  if (override != null) return override;
  return Math.min(40, Math.max(8, Math.ceil(fileCount * 0.15)));
}

export function profileBudget(fileCount: number, override?: number): number {
  if (override != null) return override;
  return Math.min(25, Math.max(5, Math.ceil(fileCount * 0.1)));
}

export function uniquePacks(packs: PackName[]): PackName[] {
  const seen = new Set<PackName>();
  const ordered: PackName[] = [];
  for (const pack of packs) {
    if (seen.has(pack)) continue;
    seen.add(pack);
    ordered.push(pack);
  }
  return ordered;
}

export function alwaysCore(packs: PackName[]): PackName[] {
  return uniquePacks(["core", ...packs]);
}