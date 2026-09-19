// Stock five-dimension screens. Wording matches the original judgments so a
// generic profile run stays comparable to upstream.
import { dimensions, mechanisms } from "./config.ts";
import type { DimensionScreen } from "./policy.ts";

export const coreScreens: DimensionScreen[] = [
  {
    key: "correctness",
    label: "Correctness",
    short: "Corr",
    definition: dimensions.correctness,
    mechanisms: { ...mechanisms.correctness },
    change: {
      instructions: {
        question:
          "Does file.patch directly support that this change likely introduces incorrect runtime behavior?",
        inspect: "file.patch",
        focus: "Concrete behavior, state, data-flow, or async errors introduced by added or modified lines",
        ignore: ["Style preferences", "Naming concerns", "Unsupported speculation"],
      },
      criteria: {
        true: {
          what: "The patch contains a realistic path to a wrong runtime result",
          examples: ["A condition now handles the opposite case", "A value is written to the wrong field"],
        },
        false: {
          what: "The patch is correct, non-behavioral, or lacks direct evidence of a bug",
          examples: ["Formatting only", "A refactor that preserves data flow"],
        },
      },
    },
    codebase: {
      instructions: {
        question: "Does file.content directly support that this code contains incorrect runtime behavior?",
        inspect: "file.content",
        focus: "Concrete behavior, state, data-flow, or async errors reachable in realistic use",
        ignore: ["Style preferences", "Naming concerns", "Missing context with no concrete failure path"],
      },
      criteria: {
        true: {
          what: "The source contains a realistic path to a wrong runtime result",
          examples: ["A condition handles the opposite case", "State is updated under the wrong key"],
        },
        false: {
          what: "The implementation is coherent or no concrete incorrect path is supported",
          not_for: "Unusual code that is still internally consistent",
        },
      },
    },
  },
  {
    key: "security",
    label: "Security",
    short: "Sec",
    definition: dimensions.security,
    mechanisms: { ...mechanisms.security },
    change: {
      instructions: {
        question: "Does file.patch directly support that this change introduces or weakens a security boundary?",
        inspect: "file.patch",
        focus: "Authorization, injection, secret exposure, trust boundaries, and unsafe defaults",
      },
      criteria: {
        true: {
          what: "The patch creates a concrete path around a security control or into an unsafe sink",
          examples: ["An authorization check is removed", "Untrusted input reaches command execution"],
        },
        false: {
          what: "No security boundary is weakened by the patch",
          not_for: "Code that merely uses security-related names",
        },
      },
    },
    codebase: {
      instructions: {
        question: "Does file.content directly support that this code weakens a security boundary?",
        inspect: "file.content",
        focus: "Authorization, injection, secret exposure, trust boundaries, and unsafe defaults",
      },
      criteria: {
        true: {
          what: "The source contains a concrete path around a control or into an unsafe sink",
          examples: ["A privileged action lacks authorization", "Untrusted input reaches command execution"],
        },
        false: {
          what: "No concrete security weakness is supported by this file",
          not_for: "Code that merely handles credentials or permissions safely",
        },
      },
    },
  },
  {
    key: "reliability",
    label: "Reliability",
    short: "Rel",
    definition: dimensions.reliability,
    mechanisms: { ...mechanisms.reliability },
    change: {
      instructions: {
        question:
          "Does file.patch directly support that this change can crash, race, leak, deadlock, or recover poorly?",
        inspect: "file.patch",
        focus: "Realistic resource, concurrency, cancellation, and failure paths",
      },
      criteria: {
        true: {
          what: "A changed path can lose work, leak resources, hang, crash, or leave inconsistent state",
          examples: ["Cleanup is skipped after failure", "Concurrent work updates shared state unsafely"],
        },
        false: { what: "The patch preserves safe lifecycle and failure handling" },
      },
    },
    codebase: {
      instructions: {
        question:
          "Does file.content directly support that this code can crash, race, leak, deadlock, or recover poorly?",
        inspect: "file.content",
        focus: "Realistic resource, concurrency, cancellation, and failure paths",
      },
      criteria: {
        true: {
          what: "A reachable path can lose work, leak resources, hang, crash, or leave inconsistent state",
          examples: ["Cleanup is skipped after failure", "Concurrent work mutates shared state unsafely"],
        },
        false: {
          what: "Lifecycle and failure handling appear safe, or no concrete failure path is supported",
        },
      },
    },
  },
  {
    key: "compatibility",
    label: "Compatibility",
    short: "Compat",
    definition: dimensions.compatibility,
    mechanisms: { ...mechanisms.compatibility },
    change: {
      instructions: {
        question:
          "Does file.patch directly support that this change can break an existing caller, format, protocol, or public behavior?",
        inspect: "file.patch",
        focus: "Externally observed contracts rather than internal implementation details",
      },
      criteria: {
        true: {
          what: "An existing consumer can fail because a contract changed without a safe migration",
          examples: ["A required field is removed", "A persisted value changes meaning"],
        },
        false: { what: "The changed contract remains compatible or is entirely internal" },
      },
    },
    codebase: {
      instructions: {
        question:
          "Does file.content directly support an internal inconsistency that can break a caller, format, protocol, or documented behavior?",
        inspect: "file.content",
        focus: "Contradictions visible in this source, not guesses about unknown historical versions",
      },
      criteria: {
        true: {
          what: "The source contains conflicting contracts or a concrete caller-facing mismatch",
          examples: [
            "A parser and serializer disagree on a required field",
            "An exported type contradicts runtime behavior",
          ],
        },
        false: {
          what: "The visible contracts are internally consistent",
          not_for: "Speculation that an API may once have behaved differently",
        },
      },
    },
  },
  {
    key: "testGap",
    label: "Test gap",
    short: "Tests",
    definition: dimensions.testGap,
    mechanisms: { ...mechanisms.testGap },
    change: {
      instructions: {
        question: "Does file.patch change important behavior without adequate targeted evidence in changedTests?",
        compare: ["file.patch", "changedTests"],
        focus: "New branches, boundaries, failure paths, and component interactions",
      },
      criteria: {
        true: {
          what: "Important changed behavior has no targeted changed test",
          examples: ["A new failure branch has no assertion", "A protocol change lacks a compatibility test"],
        },
        false: {
          what: "Changed tests exercise the important behavior, or the patch is non-behavioral",
          examples: ["A focused regression test covers the branch", "Documentation-only change"],
        },
      },
    },
    codebase: {
      instructions: {
        question:
          "Does file.content contain important behavior without adequate targeted evidence in relatedTests?",
        compare: ["file.content", "relatedTests"],
        focus: "Critical branches, boundaries, failure paths, and component interactions",
        caution: "A filename mismatch alone is not enough; identify behavior that specifically needs a test",
      },
      criteria: {
        true: {
          what: "Important behavior is present and the related tests do not exercise it",
          examples: ["An error-recovery branch has no assertion", "Authorization behavior lacks a denial test"],
        },
        false: {
          what: "Related tests cover the important behavior, or this file has no behavior needing direct tests",
          examples: ["A focused test covers the boundary", "A declarative constants module"],
        },
      },
    },
  },
];

export function withExamples(
  screen: DimensionScreen,
  extras: {
    mechanisms?: Record<string, string>;
    changeTrue?: string[];
    codebaseTrue?: string[];
    changeFocus?: string;
    codebaseFocus?: string;
  },
): DimensionScreen {
  return {
    ...screen,
    mechanisms: { ...screen.mechanisms, ...extras.mechanisms },
    change: {
      ...screen.change,
      instructions: {
        ...screen.change.instructions,
        focus: extras.changeFocus
          ? screen.change.instructions.focus + ". " + extras.changeFocus
          : screen.change.instructions.focus,
      },
      criteria: {
        ...screen.change.criteria,
        true: {
          ...screen.change.criteria.true,
          examples: [...(screen.change.criteria.true.examples ?? []), ...(extras.changeTrue ?? [])],
        },
      },
    },
    codebase: {
      ...screen.codebase,
      instructions: {
        ...screen.codebase.instructions,
        focus: extras.codebaseFocus
          ? screen.codebase.instructions.focus + ". " + extras.codebaseFocus
          : screen.codebase.instructions.focus,
      },
      criteria: {
        ...screen.codebase.criteria,
        true: {
          ...screen.codebase.criteria.true,
          examples: [...(screen.codebase.criteria.true.examples ?? []), ...(extras.codebaseTrue ?? [])],
        },
      },
    },
  };
}