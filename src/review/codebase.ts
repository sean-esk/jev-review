import { repoRootOf } from "../adapters/git.ts";
import { createJev } from "../adapters/jev.ts";
import { inspectMonorepo, rootRefusal } from "../adapters/monorepo.ts";
import { hintFiles, repositoryFiles } from "../adapters/repository-files.ts";
import { createUsageTracker } from "../adapters/usage.ts";
import { TEST_FILE } from "../domain/config.ts";
import type { ReviewRequest } from "../domain/policy.ts";
import type { ReviewReport, SourceFile } from "../domain/types.ts";
import {
  locateSourceSignal,
  profileSourceFile,
  screenSourceFile,
} from "./codebase-judgments.ts";
import { type Log, runReview } from "./workflow.ts";

const UNBOUNDED_FILE_CAP = 6;

function dedupe(files: SourceFile[]): SourceFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  });
}

export function runCodebaseReview(request: ReviewRequest, log: Log): Promise<ReviewReport> {
  const inspect = inspectMonorepo(request.scope);
  if (inspect.isMonorepoRoot) throw new Error(rootRefusal(inspect));

  const tracker = createUsageTracker(log);
  const jev = createJev(tracker);
  const policy = request.policy;
  const discovery = {
    sourceFile: policy.sourceFile,
    ignorePath: policy.ignorePath,
    limit: request.limit,
    files: request.files,
  };

  return runReview(
    request,
    log,
    tracker,
    inspect.relativeScope === "."
      ? null
      : { repoRoot: inspect.repoRoot, member: inspect.relativeScope },
    {
      mode: "codebase",
      subject: "codebase source",
      context: "related test",
      discover: (target) => {
        const repository = repositoryFiles(target, discovery);
        const extras = policy.relatedTestHints.length
          ? hintFiles(repoRootOf(target), policy.relatedTestHints, {
              sourceFile: policy.sourceFile,
              ignorePath: policy.ignorePath,
            })
          : [];
        const files = repository.filter((file) => !TEST_FILE.test(file.path));
        if (!request.limit && !request.files && !request.allowShard && files.length > UNBOUNDED_FILE_CAP) {
          throw new Error(
            "Refusing unbounded scan of " +
              files.length +
              " source files under " +
              target +
              ".\nSmall-folder smoke:\n  npm run review:codebase:save -- " +
              target +
              " --pack core --limit 2 --files roles.ts,resolve-roles.ts\nOr pass --allow-shard for a full member after the loop is cheap.",
          );
        }
        return {
          files,
          contextFiles: dedupe([
            ...repository.filter((file) => TEST_FILE.test(file.path)),
            ...extras.filter((file) => TEST_FILE.test(file.path)),
          ]),
        };
      },
      screen: (file, tests) => screenSourceFile(jev, policy, file, tests),
      profile: (file, probabilities) => profileSourceFile(jev, policy, file, probabilities),
      locate: (signal) => locateSourceSignal(jev, policy, signal),
    },
  );
}