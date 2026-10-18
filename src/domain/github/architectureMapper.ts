import { deriveRoomStatus } from '../statusEngine.ts';
import type {
  EvidenceRecord,
  InfrastructurePillar,
  Project,
  Requirement,
  RoomModule,
} from '../types.ts';
import type { ArchitecturalRoom } from '../../types.ts';
import type { GitHubScanResult } from './types.ts';

/**
 * Maps bounded GitHub repository scan results into the Living Blueprint domain model.
 * Preserves the 4-room layout stability for the isometric house.
 */
export function mapScanResultToHouse(scan: GitHubScanResult): {
  project: Project;
  rooms: ArchitecturalRoom[];
  pillars: InfrastructurePillar[];
} {
  const repoName = scan.metadata?.name || scan.repo || 'Repository';
  const timestamp = new Date().toISOString();

  // Find files by category
  const testFiles = scan.inspectedFiles.filter((f) => f.category === 'test');
  const manifestFiles = scan.inspectedFiles.filter((f) => f.category === 'manifest');
  const configFiles = scan.inspectedFiles.filter((f) => f.category === 'config');
  const sourceFiles = scan.inspectedFiles.filter((f) => f.category === 'source' || f.category === 'readme');

  // Search for domain clusters
  const authFiles = scan.inspectedFiles.filter((f) =>
    /auth|login|session|jwt|token|user|security/i.test(f.path)
  );

  const apiOrServiceFiles = scan.inspectedFiles.filter((f) =>
    /route|controller|service|api|handler|client/i.test(f.path)
  );

  const dataOrCoreFiles = scan.inspectedFiles.filter((f) =>
    /model|schema|entity|db|database|store|state|data/i.test(f.path)
  );

  // 1. Room: Core Domain & Data (Catalog/Entities/Models)
  const coreRequirements: Requirement[] = [
    { id: 'req-core-data', title: 'Domain Data Structures & Entities' },
  ];
  const coreEvidence: EvidenceRecord[] = [];

  if (dataOrCoreFiles.length > 0) {
    const f = dataOrCoreFiles[0];
    coreEvidence.push({
      id: `ev-core-${f.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      sourceType: 'source_code',
      description: `Discovered data/domain implementation in ${f.path}`,
      timestamp,
      reference: f.path,
      targetRequirementId: 'req-core-data',
    });
  } else if (sourceFiles.length > 0) {
    const f = sourceFiles[0];
    coreEvidence.push({
      id: `ev-core-src-${f.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      sourceType: 'source_code',
      description: `Discovered core source code in ${f.path}`,
      timestamp,
      reference: f.path,
      targetRequirementId: 'req-core-data',
    });
  }

  // 2. Room: Authentication & Session
  const authRequirements: Requirement[] = [
    { id: 'req-auth-access', title: 'Access Control & Authentication' },
  ];
  const authEvidence: EvidenceRecord[] = [];

  if (authFiles.length > 0) {
    const f = authFiles[0];
    authEvidence.push({
      id: `ev-auth-${f.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      sourceType: 'source_code',
      description: `Discovered auth implementation in ${f.path}`,
      timestamp,
      reference: f.path,
      targetRequirementId: 'req-auth-access',
    });
  }

  // 3. Room: Business Services & API Routes
  const serviceRequirements: Requirement[] = [
    { id: 'req-svc-api', title: 'API Handlers & Business Workflows' },
  ];
  const serviceEvidence: EvidenceRecord[] = [];

  if (apiOrServiceFiles.length > 0) {
    const f = apiOrServiceFiles[0];
    serviceEvidence.push({
      id: `ev-svc-${f.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      sourceType: 'source_code',
      description: `Discovered API/service routing in ${f.path}`,
      timestamp,
      reference: f.path,
      targetRequirementId: 'req-svc-api',
    });
  }

  // 4. Room: Routing, Gateway & Quality Verification
  const gatewayRequirements: Requirement[] = [
    { id: 'req-gw-ci', title: 'Automated Test Verification' },
  ];
  const gatewayEvidence: EvidenceRecord[] = [];

  if (testFiles.length > 0) {
    const f = testFiles[0];
    // Critical: Merely finding a test file must not establish verified.
    // We record it as source_code evidence that a test file exists, NOT a passed test result!
    gatewayEvidence.push({
      id: `ev-test-file-${f.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      sourceType: 'source_code',
      description: `Test suite file detected at ${f.path}. Automated test execution has not been verified.`,
      timestamp,
      reference: f.path,
      targetRequirementId: 'req-gw-ci',
    });
  }

  // Build Room Modules
  const coreModule: RoomModule = {
    id: 'room-catalog',
    name: 'Core Domain & Models',
    description: 'Data models, entities, and state management.',
    layer: 'core',
    requirements: coreRequirements,
    evidenceHistory: coreEvidence,
  };

  const authModule: RoomModule = {
    id: 'room-auth',
    name: authFiles.length > 0 ? 'Authentication & Access' : 'Security & Access (Uninferred)',
    description: authFiles.length > 0
      ? 'User authentication and access control logic.'
      : 'No dedicated auth subsystem inferred from representative files.',
    layer: 'service',
    requirements: authRequirements,
    evidenceHistory: authEvidence,
  };

  const serviceModule: RoomModule = {
    id: 'room-checkout',
    name: apiOrServiceFiles.length > 0 ? 'API Routes & Services' : 'Application Services',
    description: 'Service handlers, external integrations, and business logic.',
    layer: 'service',
    requirements: serviceRequirements,
    evidenceHistory: serviceEvidence,
  };

  const gatewayModule: RoomModule = {
    id: 'room-recommendations',
    name: 'Test Verification & Gateway',
    description: 'Routing configuration, entrypoints, and test suites.',
    layer: 'gateway',
    requirements: gatewayRequirements,
    evidenceHistory: gatewayEvidence,
  };

  const modules = [coreModule, authModule, serviceModule, gatewayModule];

  // Evaluate each room through the T02 status engine!
  const architecturalRooms: ArchitecturalRoom[] = modules.map((mod) => {
    const evaluation = deriveRoomStatus(mod);
    const activeFiles = mod.evidenceHistory.filter((e) => !e.isSuperseded);
    const evidenceSummary =
      activeFiles.length > 0
        ? activeFiles.map((e) => e.description).join('; ')
        : mod.requirements.length > 0 && mod.evidenceHistory.length === 0
        ? 'Planned: No implementation files discovered in scanned representative tree.'
        : evaluation.reason;

    return {
      id: mod.id,
      name: mod.name,
      layer: mod.layer,
      status: evaluation.status,
      description: mod.description,
      evidence: `Scanned from ${scan.owner}/${scan.repo}: ${evidenceSummary}`,
      metrics: {
        testsPassed: 0,
        totalTests: testFiles.length,
        filesCount: scan.inspectedFiles.length,
      },
      coords: { isoX: 0, isoY: 0, width: 140, height: 80, depth: 100 },
    };
  });

  // Discovered Infrastructure Pillars
  const pillars: InfrastructurePillar[] = [];

  const dockerFile = configFiles.find((f) => /dockerfile|docker-compose/i.test(f.path));
  if (dockerFile) {
    pillars.push({
      id: 'pillar-docker',
      name: 'Docker Infrastructure',
      description: `Container configuration detected in ${dockerFile.path}`,
      pillarType: 'runtime',
      status: 'configured',
    });
  }

  const ciFile = configFiles.find((f) => f.path.includes('.github/workflows/'));
  if (ciFile) {
    pillars.push({
      id: 'pillar-ci',
      name: 'GitHub Actions CI',
      description: `Continuous Integration workflow detected in ${ciFile.path}`,
      pillarType: 'observability',
      status: 'configured',
    });
  }

  const manifest = manifestFiles[0];
  if (manifest) {
    pillars.push({
      id: 'pillar-manifest',
      name: `Manifest: ${manifest.path}`,
      description: `Project manifest and dependency specifications in ${manifest.path}`,
      pillarType: 'hosting',
      status: 'verified',
    });
  }

  const project: Project = {
    id: `project-${scan.owner}-${scan.repo}`,
    name: repoName,
    description: scan.metadata?.description || `Scanned from github.com/${scan.owner}/${scan.repo}`,
    rooms: modules,
    pillars,
    dependencies: [],
  };

  return {
    project,
    rooms: architecturalRooms,
    pillars,
  };
}
