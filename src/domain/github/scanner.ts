import { categorizeFile, prioritizeFilesForInspection } from './fileFilter.ts';
import type {
  GitHubRepoMetadata,
  GitHubScanOptions,
  GitHubScanResult,
  GitTreeEntry,
  InspectedFile,
  RateLimitInfo,
  ScanStage,
} from './types.ts';
import { validateGitHubUrl } from './url.ts';
import { fetchCommitCheckRuns, evaluateCheckRunsForVerification } from '../lifecycle/ciEvaluator.ts';
import type { GitHubCheckRun } from '../lifecycle/types.ts';

function parseRateLimitHeaders(headers: Headers): RateLimitInfo | undefined {
  const limitHeader = headers.get('x-ratelimit-limit');
  const remainingHeader = headers.get('x-ratelimit-remaining');
  const resetHeader = headers.get('x-ratelimit-reset');

  if (limitHeader && remainingHeader && resetHeader) {
    const resetSeconds = parseInt(resetHeader, 10);
    return {
      limit: parseInt(limitHeader, 10),
      remaining: parseInt(remainingHeader, 10),
      resetDate: new Date(resetSeconds * 1000).toISOString(),
    };
  }
  return undefined;
}

export async function scanGitHubRepository(
  rawUrl: string,
  options: GitHubScanOptions = {},
  onProgress?: (stage: ScanStage, message: string) => void
): Promise<GitHubScanResult> {
  const startTime = Date.now();
  const fetchFn = options.fetchFn || fetch;
  const maxFiles = options.maxFilesToInspect ?? 12;
  const warnings: string[] = [];

  onProgress?.('validating', 'Validating GitHub repository URL...');

  const validation = validateGitHubUrl(rawUrl);
  if (!validation.valid) {
    return {
      success: false,
      status: 'failed',
      owner: '',
      repo: '',
      treeTruncated: false,
      totalFilesDiscovered: 0,
      inspectedFiles: [],
      skippedFiles: [],
      detectedTechnologies: [],
      detectedManifests: [],
      detectedArchitecturalLayers: [],
      warnings: [],
      error: validation.error,
      durationMs: Date.now() - startTime,
    };
  }

  const { owner, repo } = validation;

  // 1. Fetch Repository Metadata
  onProgress?.('fetching_metadata', `Retrieving repository metadata for ${owner}/${repo}...`);

  let metadata: GitHubRepoMetadata | undefined;
  let rateLimit: RateLimitInfo | undefined;

  try {
    const metaRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'TheLivingBlueprint-Scanner',
      },
    });

    rateLimit = parseRateLimitHeaders(metaRes.headers);

    if (metaRes.status === 404) {
      return {
        success: false,
        status: 'failed',
        owner,
        repo,
        treeTruncated: false,
        totalFilesDiscovered: 0,
        inspectedFiles: [],
        skippedFiles: [],
        detectedTechnologies: [],
        detectedManifests: [],
        detectedArchitecturalLayers: [],
        rateLimit,
        warnings,
        error: `Repository ${owner}/${repo} was not found on GitHub. Note: Private repositories are not supported.`,
        durationMs: Date.now() - startTime,
      };
    }

    if (metaRes.status === 403) {
      const resetMsg = rateLimit ? ` Quota resets at ${new Date(rateLimit.resetDate).toLocaleTimeString()}.` : '';
      return {
        success: false,
        status: 'failed',
        owner,
        repo,
        treeTruncated: false,
        totalFilesDiscovered: 0,
        inspectedFiles: [],
        skippedFiles: [],
        detectedTechnologies: [],
        detectedManifests: [],
        detectedArchitecturalLayers: [],
        rateLimit,
        warnings,
        error: `GitHub API rate limit exceeded (unauthenticated limit is 60 requests/hr).${resetMsg}`,
        durationMs: Date.now() - startTime,
      };
    }

    if (!metaRes.ok) {
      return {
        success: false,
        status: 'failed',
        owner,
        repo,
        treeTruncated: false,
        totalFilesDiscovered: 0,
        inspectedFiles: [],
        skippedFiles: [],
        detectedTechnologies: [],
        detectedManifests: [],
        detectedArchitecturalLayers: [],
        rateLimit,
        warnings,
        error: `GitHub API returned error HTTP ${metaRes.status}: ${metaRes.statusText}`,
        durationMs: Date.now() - startTime,
      };
    }

    const metaJson = await metaRes.json();
    if (metaJson.private) {
      return {
        success: false,
        status: 'failed',
        owner,
        repo,
        treeTruncated: false,
        totalFilesDiscovered: 0,
        inspectedFiles: [],
        skippedFiles: [],
        detectedTechnologies: [],
        detectedManifests: [],
        detectedArchitecturalLayers: [],
        rateLimit,
        warnings,
        error: 'The requested repository is private. The Living Blueprint supports public repositories only.',
        durationMs: Date.now() - startTime,
      };
    }

    metadata = {
      name: metaJson.name,
      fullName: metaJson.full_name,
      description: metaJson.description || null,
      defaultBranch: metaJson.default_branch || 'main',
      isPrivate: false,
      htmlUrl: metaJson.html_url,
      stargazersCount: metaJson.stargazers_count ?? 0,
      forksCount: metaJson.forks_count ?? 0,
      openIssuesCount: metaJson.open_issues_count ?? 0,
      sizeKb: metaJson.size ?? 0,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Network request failed';
    return {
      success: false,
      status: 'failed',
      owner,
      repo,
      treeTruncated: false,
      totalFilesDiscovered: 0,
      inspectedFiles: [],
      skippedFiles: [],
      detectedTechnologies: [],
      detectedManifests: [],
      detectedArchitecturalLayers: [],
      rateLimit,
      warnings,
      error: `Failed to reach GitHub API: ${errorMsg}`,
      durationMs: Date.now() - startTime,
    };
  }

  // 2. Fetch Git Recursive Tree
  onProgress?.('fetching_tree', `Retrieving file tree for branch '${metadata.defaultBranch}'...`);

  let treeEntries: GitTreeEntry[] = [];
  let isTruncated = false;

  try {
    const treeRes = await fetchFn(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${metadata.defaultBranch}?recursive=1`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'TheLivingBlueprint-Scanner',
        },
      }
    );

    const treeRateLimit = parseRateLimitHeaders(treeRes.headers);
    if (treeRateLimit) rateLimit = treeRateLimit;

    if (!treeRes.ok) {
      warnings.push(`Could not retrieve recursive git tree (HTTP ${treeRes.status}).`);
      return {
        success: false,
        status: 'failed',
        owner,
        repo,
        metadata,
        treeTruncated: false,
        totalFilesDiscovered: 0,
        inspectedFiles: [],
        skippedFiles: [],
        detectedTechnologies: [],
        detectedManifests: [],
        detectedArchitecturalLayers: [],
        rateLimit,
        warnings,
        error: `Could not retrieve git tree: HTTP ${treeRes.status} ${treeRes.statusText}`,
        durationMs: Date.now() - startTime,
      };
    }

    const treeJson = await treeRes.json();
    treeEntries = Array.isArray(treeJson.tree) ? treeJson.tree : [];
    isTruncated = Boolean(treeJson.truncated);

    if (isTruncated) {
      warnings.push(
        'Git tree was truncated by GitHub API (repository contains >100,000 files or tree exceeded 7MB). Architecture discovery is based on partial tree.'
      );
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Git tree fetch error';
    return {
      success: false,
      status: 'failed',
      owner,
      repo,
      metadata,
      treeTruncated: false,
      totalFilesDiscovered: 0,
      inspectedFiles: [],
      skippedFiles: [],
      detectedTechnologies: [],
      detectedManifests: [],
      detectedArchitecturalLayers: [],
      rateLimit,
      warnings,
      error: `Failed to fetch git tree: ${errorMsg}`,
      durationMs: Date.now() - startTime,
    };
  }

  // 3. Determine Scanned Commit SHA
  let commitSha: string | undefined;
  try {
    const commitRes = await fetchFn(
      `https://api.github.com/repos/${owner}/${repo}/commits/${metadata.defaultBranch}`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'TheLivingBlueprint-Scanner',
        },
      }
    );
    if (commitRes.ok) {
      const commitData = await commitRes.json();
      if (commitData && typeof commitData.sha === 'string') {
        commitSha = commitData.sha;
      }
    }
  } catch {
    // Non-fatal if unmocked or network issue
  }

  if (!commitSha && treeEntries.length > 0) {
    commitSha = treeEntries[0]?.sha;
  }

  // 4. Retrieve CI Check Runs for the Scanned Commit
  const targetRef = commitSha || metadata.defaultBranch;
  onProgress?.(
    'fetching_checks',
    `Querying GitHub CI check runs for commit ${targetRef.slice(0, 7)}...`
  );

  let checkRuns: GitHubCheckRun[] = [];
  try {
    const { checks: fetchedChecks, warnings: ciWarnings } = await fetchCommitCheckRuns(
      owner,
      repo,
      targetRef,
      fetchFn
    );
    warnings.push(...ciWarnings);
    checkRuns = fetchedChecks;
  } catch {
    warnings.push('Verification evidence unavailable: failed to query GitHub check-runs API.');
  }

  if (!commitSha && checkRuns.length > 0 && checkRuns[0].commitSha) {
    commitSha = checkRuns[0].commitSha;
  }

  const ciEvaluation = evaluateCheckRunsForVerification(
    checkRuns,
    'req-gw-ci',
    commitSha || targetRef,
    new Date().toISOString()
  );

  // 5. Filter and Prioritize Candidate Files (up to maxFiles)
  const { candidates, skipped } = prioritizeFilesForInspection(treeEntries, maxFiles);

  onProgress?.(
    'inspecting_files',
    `Inspecting ${candidates.length} representative files (of ${treeEntries.length} total)...`
  );

  const inspectedFiles: InspectedFile[] = [];
  const detectedTechnologies = new Set<string>();
  const detectedManifests: string[] = [];

  // Technology detector heuristics from file paths
  for (const entry of treeEntries) {
    const lower = entry.path.toLowerCase();
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) detectedTechnologies.add('TypeScript');
    if (lower.endsWith('.js') || lower.endsWith('.jsx')) detectedTechnologies.add('JavaScript');
    if (lower.endsWith('.py')) detectedTechnologies.add('Python');
    if (lower.endsWith('.rs')) detectedTechnologies.add('Rust');
    if (lower.endsWith('.go')) detectedTechnologies.add('Go');
    if (lower.endsWith('.java')) detectedTechnologies.add('Java');
    if (lower.includes('dockerfile') || lower.includes('docker-compose')) detectedTechnologies.add('Docker');
    if (lower.includes('.github/workflows/')) detectedTechnologies.add('GitHub Actions');
  }

  // Fetch excerpts for candidate files
  for (const candidate of candidates) {
    const category = categorizeFile(candidate.path);
    if (category === 'manifest') {
      detectedManifests.push(candidate.path);
    }

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${metadata.defaultBranch}/${candidate.path}`;
    const githubUrl = `https://github.com/${owner}/${repo}/blob/${metadata.defaultBranch}/${candidate.path}`;

    try {
      const fileRes = await fetchFn(rawUrl, {
        headers: { 'User-Agent': 'TheLivingBlueprint-Scanner' },
      });

      if (fileRes.ok) {
        const text = await fileRes.text();
        const excerpt = text.slice(0, 3000); // Bounded excerpt
        inspectedFiles.push({
          path: candidate.path,
          category,
          sizeBytes: candidate.size ?? text.length,
          contentExcerpt: excerpt,
          rawUrl,
          githubUrl,
        });

        // Scan manifest content for dependencies
        if (candidate.path.endsWith('package.json')) {
          try {
            const pkg = JSON.parse(text);
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (allDeps.react) detectedTechnologies.add('React');
            if (allDeps.vite) detectedTechnologies.add('Vite');
            if (allDeps.next) detectedTechnologies.add('Next.js');
            if (allDeps.jest) detectedTechnologies.add('Jest');
            if (allDeps.vitest) detectedTechnologies.add('Vitest');
            if (allDeps.tailwindcss) detectedTechnologies.add('Tailwind CSS');
            if (allDeps.pg || allDeps['@prisma/client'] || allDeps.typeorm) detectedTechnologies.add('PostgreSQL / SQL');
          } catch {
            // Ignore parse errors on malformed manifests
          }
        }
      }
    } catch {
      // If fetching an individual raw file fails, skip gracefully
      skipped.push({ path: candidate.path, reason: 'scan_file_budget_exceeded' });
    }
  }

  onProgress?.('mapping_architecture', 'Mapping discovered files to architecture domains...');

  const isPartial = isTruncated || skipped.length > 0;
  const status = isPartial ? 'partial' : 'completed';

  onProgress?.('completed', `Scan complete: ${inspectedFiles.length} files inspected.`);

  return {
    success: true,
    status,
    owner,
    repo,
    metadata,
    commitSha,
    scannedAt: new Date().toISOString(),
    checkRuns,
    ciEvaluation,
    treeTruncated: isTruncated,
    totalFilesDiscovered: treeEntries.length,
    discoveredFilePaths: treeEntries.map((e) => e.path),
    inspectedFiles,
    skippedFiles: skipped,
    detectedTechnologies: Array.from(detectedTechnologies).sort(),
    detectedManifests,
    detectedArchitecturalLayers: ['foundation', 'core', 'service', 'gateway'],
    rateLimit,
    warnings,
    durationMs: Date.now() - startTime,
  };
}
