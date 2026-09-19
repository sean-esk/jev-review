import { changedFiles } from "../adapters/git.ts";
import { createJev } from "../adapters/jev.ts";
import { createUsageTracker } from "../adapters/usage.ts";
import { TEST_FILE } from "../domain/config.ts";
import type { ReviewRequest } from "../domain/policy.ts";
import type { ReviewReport } from "../domain/types.ts";
import { locateSignal, profileFile, screenFile } from "./judgments.ts";
import { type Log, runReview } from "./workflow.ts";

export function runChangeReview(request: ReviewRequest, log: Log): Promise<ReviewReport> {
  const tracker = createUsageTracker(log);
  const jev = createJev(tracker);
  const policy = request.policy;
  return runReview(request, log, tracker, null, {
    mode: "changes",
    subject: "changed source",
    context: "changed test",
    discover: (target) => {
      const changed = changedFiles(target, {
        sourceFile: policy.sourceFile,
        ignorePath: policy.ignorePath,
        limit: request.limit,
        files: request.files,
        base: request.base,
        mergeBaseSha: request.mergeBaseSha,
        headSha: request.headSha,
      });
      const contextFiles = changed.filter((file) => TEST_FILE.test(file.path));
      return {
        files: changed.filter((file) => !TEST_FILE.test(file.path)),
        contextFiles,
      };
    },
    screen: (file, tests) => screenFile(jev, policy, file, tests),
    profile: (file, probabilities) => profileFile(jev, policy, file, probabilities),
    locate: (signal) => locateSignal(jev, policy, signal),
  });
}