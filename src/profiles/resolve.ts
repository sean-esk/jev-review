// Resolve a CLI profile + pack list into the policy a review run uses.
import {
  changeTypes,
  fileRoles,
  GENERATED_PATH,
  owners,
  SOURCE_FILE,
  SOURCE_FILE_WITH_PYTHON,
} from "../domain/config.ts";
import type { PackName, ProfileName, ReviewPolicy } from "../domain/policy.ts";
import { coreScreens } from "../domain/screens.ts";
import { contextForScope, testHintsForScope } from "./auth-context.ts";
import { lmChangeTypes, lmFileRoles, lmOwners, screensForPack, selectPacks } from "./level-method.ts";

export function resolvePolicy(
  profile: ProfileName,
  explicitPacks: PackName[] | undefined,
  scope: string,
): ReviewPolicy {
  if (profile === "generic") {
    if (explicitPacks?.some((pack) => pack !== "core")) {
      throw new Error("Packs other than core require --profile level-method");
    }
    return {
      profile,
      packs: ["core"],
      sourceFile: SOURCE_FILE,
      ignorePath: GENERATED_PATH,
      screens: coreScreens,
      owners: { ...owners },
      fileRoles: { ...fileRoles },
      changeTypes: { ...changeTypes },
      defaultBase: null,
      context: null,
      relatedTestHints: [],
    };
  }

  const packs = selectPacks(scope, explicitPacks);
  const seen = new Set<string>();
  const screens = packs.flatMap(screensForPack).filter((screen) => {
    if (seen.has(screen.key)) return false;
    seen.add(screen.key);
    return true;
  });

  return {
    profile,
    packs,
    sourceFile: SOURCE_FILE_WITH_PYTHON,
    ignorePath: GENERATED_PATH,
    screens,
    owners: lmOwners,
    fileRoles: lmFileRoles,
    changeTypes: lmChangeTypes,
    defaultBase: "origin/staging",
    context: contextForScope(scope),
    relatedTestHints: testHintsForScope(scope),
  };
}