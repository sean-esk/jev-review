// Change-review judgments. Questions come from the resolved policy.
import { choice, score } from "@typesafe-ai/sdk";
import type { Jev } from "../adapters/jev.ts";
import {
  MIN_LOCATION_CONFIDENCE,
  reviewPriorityRubric,
  ROUTE_SEVERITY,
  severityRubric,
} from "../domain/config.ts";
import { reviewAction } from "../domain/finding-rules.ts";
import { evidenceFromContent } from "../domain/writeup.ts";
import { parseHunks } from "../domain/patch.ts";
import type { ReviewPolicy } from "../domain/policy.ts";
import type { ChangedFile, FileProfile, Finding, Screening, Signal } from "../domain/types.ts";
import { noulMap, screenQuestions } from "./questions.ts";

function screenOf(policy: ReviewPolicy, key: string) {
  const screen = policy.screens.find((entry) => entry.key === key);
  if (!screen) throw new Error("Unknown dimension " + key);
  return screen;
}

export async function screenFile(
  jev: Jev,
  policy: ReviewPolicy,
  file: ChangedFile,
  changedTests: ChangedFile[],
): Promise<Screening<ChangedFile>> {
  const response = await jev.systemOne("screen", file.path, {
    state: { file, changedTests, shard: policy.context },
    questions: screenQuestions(policy, "change"),
  });
  return { file, probabilities: noulMap(policy, response.answers) };
}

export async function profileFile(
  jev: Jev,
  policy: ReviewPolicy,
  file: ChangedFile,
  screeningProbabilities: Record<string, number>,
): Promise<FileProfile> {
  const response = await jev.systemOne("profile", file.path, {
    state: { file, screeningProbabilities, shard: policy.context },
    questions: {
      category: choice(
        { question: "Which category best describes file.patch?", focus: "Primary purpose of the change" },
        policy.changeTypes,
      ),
      reviewPriority: score(
        "Rate how closely a human should review file.patch, considering the code and screeningProbabilities.",
        [...reviewPriorityRubric],
      ),
    },
  });

  return {
    file: file.path,
    category: response.answers.category.choice,
    categoryConfidence: response.answers.category.confidence,
    reviewPriority: response.answers.reviewPriority.score,
    reviewPriorityConfidence: response.answers.reviewPriority.confidence,
  };
}

export async function locateSignal(
  jev: Jev,
  policy: ReviewPolicy,
  signal: Signal<ChangedFile>,
): Promise<Finding<ChangedFile> | null> {
  const hunks = parseHunks(signal.file.patch);
  if (hunks.length === 0) return null;
  const screen = screenOf(policy, signal.dimension);

  const location = await jev.systemOne("locate", signal.file.path, {
    state: {
      file: signal.file.path,
      suspectedConcern: {
        dimension: signal.dimension,
        definition: screen.definition,
        screeningProbability: signal.probability,
      },
      candidateHunks: hunks,
      shard: policy.context,
    },
    questions: {
      evidence: choice(
        {
          question: "Which candidate hunk provides the strongest direct evidence for suspectedConcern?",
          fallback: "Select noMatch when no hunk provides sufficient evidence",
        },
        {
          ...Object.fromEntries(
            hunks.map((hunk) => [hunk.id, "Candidate beginning at changed-file line " + hunk.startLine]),
          ),
          noMatch: "No candidate hunk directly supports the suspected concern",
        },
      ),
    },
  });

  const selected = location.answers.evidence;
  if (selected.choice === "noMatch" || selected.confidence < MIN_LOCATION_CONFIDENCE) return null;
  const hunk = hunks.find((candidate) => candidate.id === selected.choice);
  if (!hunk) return null;

  const classification = await jev.systemOne("classify", signal.file.path, {
    state: {
      file: signal.file.path,
      suspectedConcern: { dimension: signal.dimension, definition: screen.definition },
      selectedEvidence: hunk,
      shard: policy.context,
    },
    questions: {
      mechanism: choice(
        "Which mechanism best describes the suspected concern supported by selectedEvidence?",
        screen.mechanisms,
      ),
    },
  });
  const mechanism = classification.answers.mechanism;
  if (mechanism.choice === "noIssue") return null;

  const impact = await jev.systemOne("severity", signal.file.path, {
    state: {
      file: signal.file.path,
      suspectedConcern: { dimension: signal.dimension, definition: screen.definition },
      selectedEvidence: hunk,
      shard: policy.context,
    },
    questions: {
      severity: score(
        "Assuming selectedEvidence exhibits suspectedConcern, rate the likely production impact.",
        [...severityRubric],
      ),
    },
  });

  const severity = impact.answers.severity;
  let owner: string | null = null;
  let ownerConfidence: number | null = null;
  if (severity.score >= ROUTE_SEVERITY) {
    const routing = await jev.systemOne("route", signal.file.path, {
      state: {
        file: signal.file.path,
        concern: {
          dimension: signal.dimension,
          mechanism: mechanism.choice,
          severity: severity.score,
        },
        selectedEvidence: hunk,
        shard: policy.context,
      },
      questions: {
        owner: choice("Which reviewer is best suited to investigate this concern?", policy.owners),
      },
    });
    owner = routing.answers.owner.choice;
    ownerConfidence = routing.answers.owner.confidence;
  }

  return {
    ...signal,
    line: hunk.startLine,
    locationConfidence: selected.confidence,
    mechanism: mechanism.choice,
    mechanismConfidence: mechanism.confidence,
    severity: severity.score,
    severityConfidence: severity.confidence,
    owner,
    ownerConfidence,
    action: reviewAction(signal.dimension, severity.score, policy.context),
    evidence: evidenceFromContent(hunk.startLine, hunk.patch),
  };
}
