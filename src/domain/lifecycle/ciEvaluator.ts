/**
 * Evaluates GitHub CI and Check Runs for functional test relevance and verification evidence.
 */

import type { EvidenceRecord } from '../types.ts';
import type { GitHubCheckRun, VerificationEvidenceOutcome } from './types.ts';

// Patterns that indicate functional testing/verification suites
const TEST_RELEVANCE_REGEX = /(?:test|tests|spec|specs|unit|e2e|integration|jest|vitest|pytest|cypress|playwright|ci[\/_-]?test|check[\/_-]?test|run[\/_-]?test)/i;

// Patterns that indicate purely non-functional checks (lint, style, docs, deployments)
const UNRELATED_CHECK_REGEX = /(?:lint|eslint|prettier|style|format|docs|typedoc|deploy|preview|pages|release|license|labeler|publish|triage)/i;

/**
 * Classifies whether a check run represents automated testing relevant to functional verification.
 */
export function classifyCheckRunRelevance(name: string): {
  isRelevantTestCheck: boolean;
  relevanceReason: string;
} {
  const isExcluded = UNRELATED_CHECK_REGEX.test(name) && !TEST_RELEVANCE_REGEX.test(name);
  if (isExcluded) {
    return {
      isRelevantTestCheck: false,
      relevanceReason: `Check "${name}" is a formatting, documentation, or deployment task and does not prove functional correctness.`,
    };
  }

  const isTest = TEST_RELEVANCE_REGEX.test(name);
  if (isTest) {
    return {
      isRelevantTestCheck: true,
      relevanceReason: `Check "${name}" matches automated test suite patterns.`,
    };
  }

  // Generic CI checks (e.g., "build", "ci", "validate") without explicit test indicators
  if (/^(?:build|ci|continuous-integration|workflow|check)$/i.test(name.trim())) {
    return {
      isRelevantTestCheck: true,
      relevanceReason: `Check "${name}" is a primary CI pipeline run.`,
    };
  }

  return {
    isRelevantTestCheck: false,
    relevanceReason: `Check "${name}" does not match known test patterns.`,
  };
}

export interface EvaluateCiOutcomeResult {
  outcome: VerificationEvidenceOutcome;
  outcomeReason: string;
  relevantTestChecks: GitHubCheckRun[];
  unrelatedChecks: GitHubCheckRun[];
  verificationEvidenceRecords: EvidenceRecord[];
}

/**
 * Evaluates a list of GitHub check runs and returns the verification outcome and minted evidence records.
 */
export function evaluateCheckRunsForVerification(
  checks: GitHubCheckRun[],
  targetRequirementId: string,
  targetCommitSha: string,
  timestamp: string
): EvaluateCiOutcomeResult {
  const relevantTestChecks = checks.filter((c) => c.isRelevantTestCheck);
  const unrelatedChecks = checks.filter((c) => !c.isRelevantTestCheck);

  if (checks.length === 0) {
    return {
      outcome: 'no_checks',
      outcomeReason: 'No GitHub Actions or CI check runs found for this commit reference.',
      relevantTestChecks: [],
      unrelatedChecks: [],
      verificationEvidenceRecords: [],
    };
  }

  if (relevantTestChecks.length === 0) {
    return {
      outcome: 'implemented_only',
      outcomeReason: `All ${checks.length} check run(s) (${checks.map((c) => c.name).join(', ')}) are linters, previews, or deployment tasks. An unrelated green check does not prove functional correctness.`,
      relevantTestChecks: [],
      unrelatedChecks,
      verificationEvidenceRecords: [],
    };
  }

  // 1. Any relevant test check failed
  const failedTestChecks = relevantTestChecks.filter(
    (c) => c.status === 'completed' && (c.conclusion === 'failure' || c.conclusion === 'timed_out')
  );

  if (failedTestChecks.length > 0) {
    const failedNames = failedTestChecks.map((c) => c.name).join(', ');
    const evidence: EvidenceRecord = {
      id: `ev-ci-fail-${targetCommitSha.slice(0, 7)}-${Date.now()}`,
      sourceType: 'test_result',
      description: `CI check run(s) failed on commit ${targetCommitSha.slice(0, 7)}: ${failedNames}`,
      timestamp,
      reference: failedTestChecks[0].htmlUrl || `commit:${targetCommitSha}`,
      targetRequirementId,
      isBlocker: true,
      verificationResult: {
        status: 'failed',
        testName: failedNames,
        details: `Check conclusion: ${failedTestChecks[0].conclusion}`,
        timestamp,
      },
    };

    return {
      outcome: 'failed',
      outcomeReason: `Automated test check(s) failed: ${failedNames}.`,
      relevantTestChecks,
      unrelatedChecks,
      verificationEvidenceRecords: [evidence],
    };
  }

  // 2. Pending or in-progress relevant checks
  const pendingTestChecks = relevantTestChecks.filter(
    (c) => c.status === 'queued' || c.status === 'in_progress'
  );

  if (pendingTestChecks.length > 0) {
    const pendingNames = pendingTestChecks.map((c) => c.name).join(', ');
    return {
      outcome: 'inconclusive',
      outcomeReason: `Relevant CI test check(s) are still running or queued: ${pendingNames}. Verification evidence cannot be established while checks are in progress.`,
      relevantTestChecks,
      unrelatedChecks,
      verificationEvidenceRecords: [],
    };
  }

  // 3. Successful relevant test checks
  const successfulTestChecks = relevantTestChecks.filter(
    (c) => c.status === 'completed' && c.conclusion === 'success'
  );

  if (successfulTestChecks.length > 0) {
    const passNames = successfulTestChecks.map((c) => c.name).join(', ');
    const evidence: EvidenceRecord = {
      id: `ev-ci-pass-${targetCommitSha.slice(0, 7)}-${Date.now()}`,
      sourceType: 'test_result',
      description: `CI test check run(s) completed successfully on commit ${targetCommitSha.slice(0, 7)}: ${passNames}`,
      timestamp,
      reference: successfulTestChecks[0].htmlUrl || `commit:${targetCommitSha}`,
      targetRequirementId,
      verificationResult: {
        status: 'passed',
        testName: passNames,
        details: `Completed successfully at ${successfulTestChecks[0].completedAt || timestamp}`,
        timestamp,
      },
    };

    return {
      outcome: 'verified',
      outcomeReason: `Relevant test check(s) passed: ${passNames}.`,
      relevantTestChecks,
      unrelatedChecks,
      verificationEvidenceRecords: [evidence],
    };
  }

  return {
    outcome: 'inconclusive',
    outcomeReason: 'Checks concluded with neutral, cancelled, or skipped statuses.',
    relevantTestChecks,
    unrelatedChecks,
    verificationEvidenceRecords: [],
  };
}
