import type {
  EvidenceClassification,
  InvestigateApiRequest,
  IssueCategory,
  IssueSeverity,
  RoomInvestigationFinding,
  ValidatedCodeEvidence,
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

export interface RawCodeEvidencePayload {
  filePath?: unknown;
  targetIdentifier?: unknown;
  codeSnippet?: unknown;
  explanation?: unknown;
}

export interface RawInvestigationPayload {
  title?: unknown;
  explanation?: unknown;
  category?: unknown;
  severity?: unknown;
  evidenceClassification?: unknown;
  evidencePaths?: unknown;
  codeEvidence?: RawCodeEvidencePayload;
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
  const rawTitle =
    typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim()
      : 'Architecture & Evidence Review';
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

  // 5. Build lookup maps from inspected files and git tree paths
  const inspectedFileMap = new Map<
    string,
    { path: string; category: string; contentExcerpt: string }
  >();
  for (const f of repoContext.inspectedFiles) {
    if (f && f.path) {
      inspectedFileMap.set(f.path.toLowerCase(), {
        path: f.path,
        category: f.category,
        contentExcerpt: f.contentExcerpt || '',
      });
    }
  }

  const discoveredPathSet = new Set(
    (repoContext.discoveredFilePaths || []).map((p) =>
      typeof p === 'string' ? p.toLowerCase() : ''
    )
  );

  const validatedRefs: ValidatedEvidenceRef[] = [];
  const rejectedPaths: string[] = [];
  const rawPaths = Array.isArray(raw.evidencePaths) ? raw.evidencePaths : [];

  for (const item of rawPaths) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const cleanPath = item.trim();
    const lower = cleanPath.toLowerCase();

    const inspected = inspectedFileMap.get(lower);
    const isDiscovered = discoveredPathSet.has(lower);

    if (inspected) {
      validatedRefs.push({
        path: inspected.path,
        isInspected: true,
        githubUrl: `https://github.com/${repoContext.owner}/${repoContext.repo}/blob/${repoContext.branch}/${inspected.path}`,
        note: inspected.contentExcerpt
          ? 'Code inspected in current scan'
          : 'File catalogued in scan, but content empty or uninspected',
      });
    } else if (isDiscovered) {
      validatedRefs.push({
        path: cleanPath,
        isInspected: false,
        githubUrl: `https://github.com/${repoContext.owner}/${repoContext.repo}/blob/${repoContext.branch}/${cleanPath}`,
        note: 'Discovered in git tree, but content not inspected in sample',
      });
    } else {
      // Fabricated / ungrounded path: rejected and explicitly tracked
      rejectedPaths.push(cleanPath);
    }
  }

  // 6. Validate Code Evidence (excerpt, identifier, line numbers)
  let validatedCodeEvidence: ValidatedCodeEvidence | undefined;
  let codeEvidenceVerified = false;
  const rejectedCodeItems: string[] = [];

  if (raw.codeEvidence && typeof raw.codeEvidence === 'object') {
    const rawCe = raw.codeEvidence;
    const rawFilePath = typeof rawCe.filePath === 'string' ? rawCe.filePath.trim() : '';
    const rawIdent =
      typeof rawCe.targetIdentifier === 'string' ? rawCe.targetIdentifier.trim() : undefined;
    const rawSnippet =
      typeof rawCe.codeSnippet === 'string' ? rawCe.codeSnippet.trim() : undefined;
    const rawCeExp =
      typeof rawCe.explanation === 'string' ? rawCe.explanation.trim() : undefined;

    if (rawFilePath) {
      const inspected = inspectedFileMap.get(rawFilePath.toLowerCase());
      if (!inspected || !inspected.contentExcerpt) {
        rejectedCodeItems.push(`codeEvidence file "${rawFilePath}" (content not inspected)`);
        validatedCodeEvidence = {
          filePath: rawFilePath,
          targetIdentifier: rawIdent,
          codeSnippet: rawSnippet,
          isVerified: false,
          explanation: rawCeExp,
        };
      } else {
        const fileContent = inspected.contentExcerpt;
        let snippetFound = true;
        let derivedLineNumber: number | undefined;

        if (rawSnippet) {
          const matchIdx = fileContent.indexOf(rawSnippet);
          if (matchIdx !== -1) {
            // Derive 1-indexed line number directly from inspected source content
            derivedLineNumber = fileContent.slice(0, matchIdx).split('\n').length;
          } else {
            snippetFound = false;
            rejectedCodeItems.push(
              `codeEvidence snippet "${rawSnippet}" (not found in ${inspected.path})`
            );
          }
        }

        let identFound = true;
        if (rawIdent) {
          if (!fileContent.includes(rawIdent)) {
            identFound = false;
            rejectedCodeItems.push(
              `codeEvidence identifier "${rawIdent}" (not found in ${inspected.path})`
            );
          }
        }

        if (snippetFound && identFound && (rawSnippet || rawIdent)) {
          codeEvidenceVerified = true;
          validatedCodeEvidence = {
            filePath: inspected.path,
            targetIdentifier: rawIdent,
            codeSnippet: rawSnippet,
            derivedLineNumber,
            isVerified: true,
            explanation: rawCeExp,
          };
        } else {
          validatedCodeEvidence = {
            filePath: inspected.path,
            targetIdentifier: rawIdent,
            codeSnippet: rawSnippet,
            isVerified: false,
            explanation: rawCeExp,
          };
        }
      }
    }
  }

  // 7. Check for Hallucinated Identifiers in Explanation or Next Step
  const knownHallucinated = ['validateTaskInput', 'input.title'];
  for (const fab of knownHallucinated) {
    const appearsInRaw =
      rawTitle.includes(fab) || rawExplanation.includes(fab) || rawNextStep.includes(fab);
    if (appearsInRaw) {
      let reallyExists = false;
      for (const f of inspectedFileMap.values()) {
        if (f.contentExcerpt.includes(fab)) {
          reallyExists = true;
          break;
        }
      }
      if (!reallyExists) {
        rejectedCodeItems.push(`${fab} (fabricated identifier)`);
      }
    }
  }

  // Enrich matching validatedRefs with verified code evidence
  if (validatedCodeEvidence?.isVerified) {
    for (const ref of validatedRefs) {
      if (ref.path.toLowerCase() === validatedCodeEvidence.filePath.toLowerCase()) {
        ref.verifiedExcerpt = validatedCodeEvidence.codeSnippet;
        ref.verifiedIdentifier = validatedCodeEvidence.targetIdentifier;
        ref.derivedLineNumber = validatedCodeEvidence.derivedLineNumber;
        if (ref.derivedLineNumber) {
          ref.note = `Code inspected (Line ${ref.derivedLineNumber})`;
        }
      }
    }
  }

  // Append explicit rejection notice to uncertainties
  let finalUncertainties = rawUncertainties;
  if (rejectedPaths.length > 0) {
    const rejectionNotice = `[REJECTED UNGROUNDED EVIDENCE: Excluded ${rejectedPaths.length} path(s) not found in scanned git tree: ${rejectedPaths.join(', ')}]`;
    finalUncertainties = finalUncertainties ? `${finalUncertainties} ${rejectionNotice}` : rejectionNotice;
  }
  if (rejectedCodeItems.length > 0) {
    const codeRejectionNotice = `[REJECTED CODE CLAIMS: Excluded ${rejectedCodeItems.length} unsupported code item(s): ${rejectedCodeItems.join(', ')}]`;
    finalUncertainties = finalUncertainties ? `${finalUncertainties} ${codeRejectionNotice}` : codeRejectionNotice;
  }

  // 8. Classification Grounding Rules:
  // An existing file path is NOT proof of code behavior.
  // To be 'observed':
  // - Must have at least one inspected file among validated references.
  // - Zero rejected paths or code items.
  // - If codeEvidence was provided, it must be verified.
  const hasInspectedRef = validatedRefs.some((r) => r.isInspected);
  if (classification === 'observed') {
    if (!hasInspectedRef || rejectedPaths.length > 0 || rejectedCodeItems.length > 0) {
      classification = validatedRefs.length > 0 ? 'inferred' : 'unverified';
    } else if (raw.codeEvidence && !codeEvidenceVerified) {
      classification = 'inferred';
    }
  }

  // If there are zero valid references, classify as unverified
  if (validatedRefs.length === 0 && classification === 'observed') {
    classification = 'unverified';
  }

  // Justify severity: unverified or unknown issues cannot be marked 'high'
  if ((classification === 'unverified' || category === 'unknown') && severity === 'high') {
    severity = 'medium';
  }

  // 9. Companion Messages
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

  const allRejected = [...rejectedPaths, ...rejectedCodeItems];

  return {
    roomId,
    roomName,
    title: rawTitle.slice(0, 120),
    explanation: rawExplanation.slice(0, 800),
    category,
    severity,
    evidenceClassification: classification,
    evidenceReferences: validatedRefs,
    rejectedReferences: allRejected.length > 0 ? allRejected : undefined,
    codeEvidence: validatedCodeEvidence,
    recommendedNextStep: rawNextStep.slice(0, 300),
    uncertainties: finalUncertainties.slice(0, 500),
    companionMessages,
  };
}
