import type { RoomInvestigationFinding } from './types.ts';

interface PromptGenerationContext {
  owner: string;
  repo: string;
  branch: string;
  commitSha?: string;
}

export function generateRepairPrompt(
  finding: RoomInvestigationFinding,
  repoContext: PromptGenerationContext
): string {
  const isWeakEvidence =
    finding.evidenceClassification === 'unverified' ||
    finding.evidenceReferences.length === 0 ||
    finding.category === 'unknown';

  const refLines =
    finding.evidenceReferences.length > 0
      ? finding.evidenceReferences
          .map((r) => `- \`${r.path}\` (${r.isInspected ? 'inspected in scan' : 'in git tree, not inspected'})${r.note ? `: ${r.note}` : ''}`)
          .join('\n')
      : '- No verified file references confirmed in scan.';

  const branchRef = repoContext.commitSha
    ? `${repoContext.branch} (${repoContext.commitSha.slice(0, 7)})`
    : repoContext.branch;

  if (isWeakEvidence) {
    // Investigation-First Prompt when evidence is weak or unverified
    return `# Investigation & Diagnostic Task: ${finding.roomName}

## Repository Context
- **Repository**: \`${repoContext.owner}/${repoContext.repo}\`
- **Target Branch**: \`${branchRef}\`
- **Architectural Room / Module**: \`${finding.roomName}\` (\`${finding.roomId}\`)
- **Suspected Issue**: ${finding.title}
- **Evidence Classification**: **UNVERIFIED / INSUFFICIENT EVIDENCE** (Category: \`${finding.category}\`, Severity: \`${finding.severity}\`)

## Diagnostic Assessment
${finding.explanation}

## Known Uncertainties & Caveats
${finding.uncertainties}

## Supporting References
${refLines}

---

## Instructions for Coding Agent (Investigation First)

> [!IMPORTANT]
> The suspected issue is currently **unverified**. Do NOT assume this issue exists or make speculative code modifications. You must investigate and verify first.

1. **Investigate Before Editing**:
   - Inspect the codebase to determine whether the suspected issue (\`${finding.title}\`) actually exists or is a false positive.
   - If relevant files were skipped in the initial bounded scan, locate the actual implementation files for \`${finding.roomName}\`.
2. **Determine Root Cause**:
   - If an issue or test gap exists, identify the precise files, functions, or configurations responsible.
   - If the implementation is already sound, report that finding and do not make unnecessary changes.
3. **Targeted Implementation Goals (if verified)**:
   - Resolve the confirmed gap: ${finding.recommendedNextStep}
   - Avoid refactoring unrelated subsystems or dependencies.
4. **Acceptance Criteria**:
   - The diagnosis is grounded in actual inspected code.
   - Any added or updated logic has corresponding automated tests.
   - \`npm test\` (or the repository's test command) and build pass cleanly.
5. **Reporting & Honesty Policy**:
   - List every file touched, command executed, and test run.
   - **Never claim a test passed unless it was actually executed and returned exit code 0.**
   - Clearly state what was checked, what was skipped, and any remaining risks.
`;
  }

  // Targeted Repair Prompt when evidence is observed or inferred with supporting files
  return `# Task: Address ${finding.title} in ${finding.roomName}

## Repository Context
- **Repository**: \`${repoContext.owner}/${repoContext.repo}\`
- **Target Branch**: \`${branchRef}\`
- **Architectural Room / Module**: \`${finding.roomName}\` (\`${finding.roomId}\`)
- **Issue Category**: \`${finding.category}\`
- **Assessed Severity**: \`${finding.severity.toUpperCase()}\`
- **Evidence Classification**: \`${finding.evidenceClassification.toUpperCase()}\`

## Observed Issue Description
${finding.explanation}

## Supporting Evidence & Relevant Files
${refLines}

## Known Uncertainties
${finding.uncertainties}

## Recommended Resolution
${finding.recommendedNextStep}

---

## Instructions for Coding Agent

1. **Verify the Diagnosis**:
   - Inspect the files referenced above before making any edits.
   - Confirm the failure mode or test gap in your local environment.
2. **Scope of Changes**:
   - Focus strictly on addressing \`${finding.title}\`.
   - Preserve existing architectural patterns and avoid unrelated redesigns or refactoring.
3. **Verification Steps**:
   - Run the relevant unit or integration tests for \`${finding.roomName}\`.
   - If tests are missing, add targeted unit tests covering the edge cases.
4. **Acceptance Criteria**:
   - Implementation satisfies: ${finding.recommendedNextStep}
   - Existing and new tests pass without regressions.
   - Project build and type-checking succeed.
5. **Reporting & Honesty Policy**:
   - Explicitly report: files changed, commands run, test outcomes, and remaining issues.
   - **Never claim tests passed or builds succeeded unless they actually ran with passing results.**
`;
}
