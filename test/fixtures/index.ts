export * from './types.ts';
export * from './mockFetch.ts';
export { jsApiFixture } from './jsApiFixture.ts';
export { tsFrontendFixture } from './tsFrontendFixture.ts';
export { pyBackendFixture } from './pyBackendFixture.ts';
export { monorepoFixture } from './monorepoFixture.ts';
export { docHeavyFixture } from './docHeavyFixture.ts';
export { unsupportedFixture } from './unsupportedFixture.ts';

import { jsApiFixture } from './jsApiFixture.ts';
import { tsFrontendFixture } from './tsFrontendFixture.ts';
import { pyBackendFixture } from './pyBackendFixture.ts';
import { monorepoFixture } from './monorepoFixture.ts';
import { docHeavyFixture } from './docHeavyFixture.ts';
import { unsupportedFixture } from './unsupportedFixture.ts';
import type { BenchmarkFixture } from './types.ts';

export const allBenchmarkFixtures: BenchmarkFixture[] = [
  jsApiFixture,
  tsFrontendFixture,
  pyBackendFixture,
  monorepoFixture,
  docHeavyFixture,
  unsupportedFixture,
];
