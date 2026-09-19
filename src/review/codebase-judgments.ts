// Codebase-scan judgments. These ask whether an issue exists in complete
// source, rather than whether a patch introduced one.
import { choice, score } from "@typesafe-ai/sdk";
import { basename, dirname } from "node:path";
import type { Jev } from "../adapters/jev.ts";
import {
  BLOCKING_SEVERITY,
  MIN_LOCATION_CONFIDENCE,
  reviewPriorityRubric,
  ROUTE_SEVERITY,
  severityRubric,
} from "../domain/config.ts";
import type { ReviewPolicy } from "../domain/policy.ts";
import type { FileProfile, Finding, Screening, Signal, SourceFile } from "../domain/types.ts";
import { maxNoulMap, noulMap, screenQuestions } from "./questions.ts";

const REGION_LINES = 80;
const SCREEN_REGION_LINES = 160;
const MAX_RELATED_TESTS = 4;
const MAX_TEST_SNIPPET_CHARS = 1_800;

function screenOf(policy: ReviewPolicy, key: string) {
  const screen = policy.screens.find((entry) => entry.key === key);
  if (!screen) throw new Error("Unknown dimension " + key);
  return screen;
}

export async function screenSourceFile(
  jev: Jev,
  policy: ReviewPolicy,
  file: SourceFile,
  testFiles: SourceFile[],
): Promise<Screening<SourceFile>> {
  const relatedTests = selectRelatedTests(file, testFiles);
  const results: Array<Record<string, number>> = [];

  for (const region of sourceRegions(file.content, SCREEN_REGION_LINES)) {
    const response = await jev.systemOne("screen", file.path, {
      state: {
        file: { path: file.path, startLine: region.startLine, content: region.content },
        relatedTests,
        shard: policy.context,
      },
      questions: screenQuestions(policy, "codebase"),
    });
    results.push(noulMap(policy, response.answers));
  }

  return { file, probabilities: maxNoulMap(results) };
}

export async function profileSourceFile(
  jev: Jev,
  policy: ReviewPolicy,
  file: SourceFile,
  screeningProbabilities: Record<string, number>,
): Promise<FileProfile> {
  const response = await jev.systemOne("profile", file.path, {
    state: { file, screeningProbabilities, shard: policy.context },
    questions: {
      category: choice(
        { question: "Which role best describes this source file?", focus: "Primary runtime responsibility" },
        policy.fileRoles,
      ),
      reviewPriority: score(
        "Rate how closely a human should review this complete file, considering its role and screeningProbabilities.",
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

export async function locateSourceSignal(
  jev: Jev,
  policy: ReviewPolicy,
  signal: Signal<SourceFile>,
): Promise<Finding<SourceFile> | null> {
  const regions = sourceRegions(signal.file.content);
  if (regions.length === 0) return null;
  const screen = screenOf(policy, signal.dimension);

  const location = await jev.systemOne("locate", signal.file.path, {
    state: {
      file: signal.file.path,
      suspectedConcern: {
        dimension: signal.dimension,
        definition: screen.definition,
        focus: screen.codebase.instructions.focus,
        examples: screen.codebase.criteria.true.examples ?? [],
        not_for: screen.codebase.criteria.false.not_for ?? null,
        screeningProbability: signal.probability,
      },
      candidateRegions: regions,
      shard: policy.context,
    },
    questions: {
      evidence: choice(
        {
          question:
            "Which candidate region provides the strongest direct evidence for suspectedConcern (use focus and examples)?",
          fallback: "Select noMatch when no region provides sufficient evidence",
        },
        {
          ...Object.fromEntries(regions.map((region) => [region.id, regionLabel(region)])),
          noMatch: "No source region directly supports the suspected concern",
        },
      ),
    },
  });

  const selected = location.answers.evidence;
  if (selected.choice === "noMatch" || selected.confidence < MIN_LOCATION_CONFIDENCE) return null;
  const region = regions.find((candidate) => candidate.id === selected.choice);
  if (!region) return null;

  const classification = await jev.systemOne("classify", signal.file.path, {
    state: {
      file: signal.file.path,
      suspectedConcern: { dimension: signal.dimension, definition: screen.definition },
      selectedEvidence: region,
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
      selectedEvidence: region,
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
        selectedEvidence: region,
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
    line: region.startLine,
    locationConfidence: selected.confidence,
    mechanism: mechanism.choice,
    mechanismConfidence: mechanism.confidence,
    severity: severity.score,
    severityConfidence: severity.confidence,
    owner,
    ownerConfidence,
    action: severity.score >= BLOCKING_SEVERITY ? "request_changes" : "comment",
  };
}

function regionLabel(region: { startLine: number; content: string }): string {
  const preview =
    region.content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*")) ??
    "";
  const clipped = preview.length > 90 ? preview.slice(0, 87) + "..." : preview;
  return "Line " + region.startLine + (clipped ? ": " + clipped : "");
}

function sourceRegions(content: string, linesPerRegion = REGION_LINES) {
  const lines = content.split("\n");
  const count = Math.ceil(lines.length / linesPerRegion);
  return Array.from({ length: count }, (_, index) => ({
    id: "R" + (index + 1),
    startLine: index * linesPerRegion + 1,
    content: lines.slice(index * linesPerRegion, (index + 1) * linesPerRegion).join("\n"),
  }));
}

function packagePrefix(path: string): string | null {
  const match = path.match(/^(packages\/[^/]+|apps\/[^/]+|backend|services\/[^/]+)/);
  return match ? match[1] : null;
}

function compactStem(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, "");
}

function stemsRelated(sourceStem: string, testPath: string): boolean {
  const source = compactStem(sourceStem);
  const testName = compactStem(basename(testPath).replace(/\.(?:spec|test)\.[^.]+$/, ""));
  if (!source || !testName) return false;
  return source.includes(testName) || testName.includes(source);
}

function selectRelatedTests(file: SourceFile, testFiles: SourceFile[]): SourceFile[] {
  const stem = basename(file.path).replace(/\.[^.]+$/, "");
  const directory = dirname(file.path);
  const member = packagePrefix(file.path);
  return testFiles
    .map((test) => ({
      test,
      score:
        (test.path.includes(stem) || stemsRelated(stem, test.path) ? 2 : 0) +
        (test.path.startsWith(directory) ? 2 : 0) +
        (member && test.path.startsWith(member) ? 1 : 0) +
        (file.path.startsWith("backend/") && test.path.startsWith("backend/tests/") ? 2 : 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.test.path.localeCompare(b.test.path))
    .slice(0, MAX_RELATED_TESTS)
    .map(({ test }) => compactTest(test, stem));
}

function compactTest(test: SourceFile, sourceStem: string): SourceFile {
  const lines = test.content.split("\n");
  const selected = new Set<number>();
  const stem = sourceStem.toLowerCase();

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].toLowerCase();
    if (
      line.includes(stem) ||
      compactStem(line).includes(compactStem(stem)) ||
      line.includes("describe(") ||
      line.includes("describe.") ||
      line.includes("test(") ||
      line.includes("test.") ||
      line.includes("it(") ||
      line.includes("it.")
    ) {
      for (let nearby = Math.max(0, index - 2); nearby <= Math.min(lines.length - 1, index + 2); nearby++) {
        selected.add(nearby);
      }
    }
  }

  let content = [...selected]
    .sort((a, b) => a - b)
    .map((index) => lines[index])
    .join("\n");
  if (content.length === 0) content = test.content;
  if (content.length > MAX_TEST_SNIPPET_CHARS) {
    const side = Math.floor((MAX_TEST_SNIPPET_CHARS - 7) / 2);
    content = content.slice(0, side) + "\n...\n" + content.slice(-side);
  }

  return { path: test.path, content };
}