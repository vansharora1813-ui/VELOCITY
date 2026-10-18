import type {
  EvidenceClassification,
  InvestigateApiRequest,
  IssueCategory,
  IssueSeverity,
  RoomInvestigationFinding,
  ValidatedEvidenceRef,
} from './types.ts';
import type { CompanionReplyMessage } from '../../server/types.ts';

const VALID_CATEGORIES = new Set<IssueCategory>([
  'missing_proof',
  'possible_bug',
  'security_risk',
  'configuration_risk',
  'test_gap',
  'dependency_risk',
  'unknown',
]);

const VALID_SEVERITIES = new Set<IssueSeverity>(['info', 'low', 'medium', 'high']);
const VALID_CLASSIFICATIONS = new Set<EvidenceClassification>(['observed', 'inferred', 'unverified']);

export interface RawInvestigationPayload {
  title?: unknown;
  explanation?: unknown;
  category?: unknown;
  severity?: unknown;
  evidenceClassification?: unknown;
  evidencePaths?: unknown;
  recommendedNextStep?: unknown;
  uncertainties?: unknown;
  companionMessages?: unknown;
}

export function validateInvestigationFinding(
  raw: RawInvestigationPayload,
  request: InvestigateApiRequest
): RoomInvestigationFinding {
  const { roomId, roomName, repoContext } = request;

  // 1. Title & Explanation
  const rawTitle = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Architecture & Evidence Review';
  const rawExplanation =
    typeof raw.explanation === 'string' && raw.explanation.trim()
      ? raw.explanation.trim()
      : 'No specific issue identified from current evidence.';
  const rawNextStep =
    typeof raw.recommendedNextStep === 'string' && raw.recommendedNextStep.trim()
      ? raw.recommendedNextStep.trim()
      : 'Verify implementation files and add automated test coverage.';
  const rawUncertainties =
    typeof raw.uncertainties === 'string' && raw.uncertainties.trim()
      ? raw.uncertainties.trim()
      : 'Limited to inspected file sample. Full test execution unverified.';

  // 2. Category
  let category: IssueCategory = 'unknown';
  if (typeof raw.category === 'string' && VALID_CATEGORIES.has(raw.category as IssueCategory)) {
    category = raw.category as IssueCategory;
  }

  // 3. Severity
  let severity: IssueSeverity = 'info';
  if (typeof raw.severity === 'string' && VALID_SEVERITIES.has(raw.severity as IssueSeverity)) {
    severity = raw.severity as IssueSeverity;
  }

  // 4. Evidence Classification
  let classification: EvidenceClassification = 'inferred';
  if (
    typeof raw.evidenceClassification === 'string' &&
    VALID_CLASSIFICATIONS.has(raw.evidenceClassification as EvidenceClassification)
  ) {
    classification = raw.evidenceClassification as EvidenceClassification;
  }

  // 5. Evidence Reference Validation against Actual Scan Context
  const inspectedPathSet = new Set(repoContext.inspectedFiles.map((f) => f.path.toLowerCase()));
  const discoveredPathSet = new Set(
    (repoContext.discoveredFilePaths || []).map((p) => p.toLowerCase())
  );

  const validatedRefs: ValidatedEvidenceRef[] = [];
  const rawPaths = Array.isArray(raw.evidencePaths) ? raw.evidencePaths : [];

  for (const item of rawPaths) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const cleanPath = item.trim();
    const lower = cleanPath.toLowerCase();

    const isInspected = inspectedPathSet.has(lower);
    const isDiscovered = discoveredPathSet.has(lower);

    if (isInspected) {
      validatedRefs.push({
        path: cleanPath,
        isInspected: true,
        githubUrl: `https://github.com/${repoContext.owner}/${repoContext.repo}/blob/${repoContext.branch}/${cleanPath}`,
        note: 'Code inspected in current scan',
      });
    } else if (isDiscovered) {
      validatedRefs.push({
        path: cleanPath,
        isInspected: false,
        githubUrl: `https://github.com/${repoContext.owner}/${repoContext.repo}/blob/${repoContext.branch}/${cleanPath}`,
        note: 'Discovered in git tree, but content not inspected in 12-file sample',
      });
    } else {
      // Fabricated / ungrounded path: intentionally excluded from validated references
    }
  }

  // Check: if classification is 'observed', but no inspected files exist among validated refs,
  // demote to 'inferred' or 'unverified'
  const hasInspectedRef = validatedRefs.some((r) => r.isInspected);
  if (classification === 'observed' && !hasInspectedRef) {
    classification = validatedRefs.length > 0 ? 'inferred' : 'unverified';
  }

  // If there are zero valid references, classify as unverified
  if (validatedRefs.length === 0 && classification === 'observed') {
    classification = 'unverified';
  }

  // Justify severity: unverified or unknown issues cannot be marked 'high'
  if ((classification === 'unverified' || category === 'unknown') && severity === 'high') {
    severity = 'medium';
  }

  // 6. Companion Messages
  const companionMessages: CompanionReplyMessage[] = [];
  if (Array.isArray(raw.companionMessages)) {
    for (const msg of raw.companionMessages.slice(0, 2)) {
      if (
        msg &&
        typeof msg === 'object' &&
        (msg.speaker === 'dog' || msg.speaker === 'cat') &&
        typeof msg.text === 'string' &&
        msg.text.trim()
      ) {
        companionMessages.push({
          speaker: msg.speaker,
          text: msg.text.trim().slice(0, 300),
          evidenceReference:
            typeof msg.evidenceReference === 'string' ? msg.evidenceReference.slice(0, 100) : undefined,
        });
      }
    }
  }

  if (companionMessages.length === 0) {
    companionMessages.push({
      speaker: 'dog',
      text: `Barkley here! I investigated ${roomName}. Here is what the current evidence supports.`,
    });
  }

  return {
    roomId,
    roomName,
    title: rawTitle.slice(0, 120),
    explanation: rawExplanation.slice(0, 800),
    category,
    severity,
    evidenceClassification: classification,
    evidenceReferences: validatedRefs,
    recommendedNextStep: rawNextStep.slice(0, 300),
    uncertainties: rawUncertainties.slice(0, 300),
    companionMessages,
  };
}
