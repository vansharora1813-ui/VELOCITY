import type { FileCategory, GitTreeEntry, SkippedFile } from './types.ts';

const IGNORED_DIRECTORY_PREFIXES = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  '.next/',
  '.nuxt/',
  'vendor/',
  'target/',
  'bin/',
  'obj/',
  'coverage/',
  '.vscode/',
  '.idea/',
  'venv/',
  '.venv/',
  '__pycache__/',
  '.pytest_cache/',
  '.turbo/',
  'out/',
];

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'cargo.lock',
  'poetry.lock',
  'composer.lock',
  'gemfile.lock',
]);

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'svg', 'webp', 'bmp', 'pdf',
  'zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'wasm', 'mp4', 'mov', 'webm',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'exe', 'dll', 'dylib', 'so',
  'min.js', 'min.css', 'map', 'pyc', 'class', 'jar', 'o', 'a',
]);

const MANIFEST_NAMES = new Set([
  'package.json',
  'cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'gemfile',
  'composer.json',
]);

export function categorizeFile(path: string): FileCategory {
  const lower = path.toLowerCase();
  const basename = lower.split('/').pop() || '';

  if (MANIFEST_NAMES.has(basename)) {
    return 'manifest';
  }
  if (basename.startsWith('readme')) {
    return 'readme';
  }
  if (
    basename.includes('test') ||
    basename.includes('spec') ||
    lower.includes('/tests/') ||
    lower.includes('/__tests__/')
  ) {
    return 'test';
  }
  if (
    basename.startsWith('dockerfile') ||
    basename.includes('docker-compose') ||
    lower.includes('.github/workflows/') ||
    basename.endsWith('.config.js') ||
    basename.endsWith('.config.ts') ||
    basename === 'tsconfig.json'
  ) {
    return 'config';
  }
  if (lower.endsWith('.md') || lower.includes('/docs/')) {
    return 'documentation';
  }
  return 'source';
}

export function isFileIgnored(path: string): { ignored: boolean; reason?: SkippedFile['reason'] } {
  const lower = path.toLowerCase();
  const basename = lower.split('/').pop() || '';

  for (const prefix of IGNORED_DIRECTORY_PREFIXES) {
    if (lower.startsWith(prefix) || lower.includes(`/${prefix}`)) {
      return { ignored: true, reason: 'ignored_directory' };
    }
  }

  if (LOCKFILE_NAMES.has(basename)) {
    return { ignored: true, reason: 'lockfile' };
  }

  const parts = basename.split('.');
  if (parts.length > 1) {
    const ext = parts.pop()!;
    if (BINARY_EXTENSIONS.has(ext)) {
      return { ignored: true, reason: 'binary_asset' };
    }
    // Also check double-extension like .min.js
    const subExt = `${parts.pop()}.${ext}`;
    if (BINARY_EXTENSIONS.has(subExt)) {
      return { ignored: true, reason: 'binary_asset' };
    }
  }

  return { ignored: false };
}

/**
 * Prioritizes discovered tree entries for bounded source-code reading (up to maxFiles).
 */
export function prioritizeFilesForInspection(
  tree: GitTreeEntry[],
  maxFiles = 12,
  maxSizeBytes = 80 * 1024
): { candidates: GitTreeEntry[]; skipped: SkippedFile[] } {
  const skipped: SkippedFile[] = [];
  const validBlobs: GitTreeEntry[] = [];

  for (const entry of tree) {
    if (entry.type !== 'blob') {
      continue;
    }

    const { ignored, reason } = isFileIgnored(entry.path);
    if (ignored && reason) {
      skipped.push({ path: entry.path, reason });
      continue;
    }

    if (entry.size !== undefined && entry.size > maxSizeBytes) {
      skipped.push({ path: entry.path, reason: 'exceeds_file_size_limit' });
      continue;
    }

    validBlobs.push(entry);
  }

  // Rank by architectural importance:
  // 1: Primary manifests (package.json, pyproject.toml, Cargo.toml)
  // 2: Root README
  // 3: Key infrastructure / config (Dockerfile, docker-compose, CI)
  // 4: Core entrypoints & routing (index, main, app, server, api)
  // 5: Representative test files
  // 6: Other source files
  const scoreEntry = (entry: GitTreeEntry): number => {
    const lower = entry.path.toLowerCase();
    const basename = lower.split('/').pop() || '';
    const category = categorizeFile(entry.path);

    if (category === 'manifest' && !lower.includes('/')) return 100;
    if (category === 'manifest') return 90;
    if (category === 'readme' && !lower.includes('/')) return 85;
    if (category === 'config' && (basename.startsWith('dockerfile') || basename.includes('docker-compose'))) return 80;
    if (category === 'config' && lower.includes('.github/workflows/')) return 75;
    if (basename.startsWith('index.') || basename.startsWith('main.') || basename.startsWith('app.')) return 70;
    if (lower.includes('route') || lower.includes('controller') || lower.includes('service') || lower.includes('auth')) return 65;
    if (category === 'test') return 60;
    if (category === 'config') return 50;
    if (category === 'source') return 40;
    return 10;
  };

  validBlobs.sort((a, b) => scoreEntry(b) - scoreEntry(a));

  const candidates = validBlobs.slice(0, maxFiles);
  const remaining = validBlobs.slice(maxFiles);

  for (const rem of remaining) {
    skipped.push({ path: rem.path, reason: 'scan_file_budget_exceeded' });
  }

  return { candidates, skipped };
}
