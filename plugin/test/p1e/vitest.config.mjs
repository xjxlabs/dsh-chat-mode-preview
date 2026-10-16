import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import base from '../p1/vitest.config.mjs';

export default {
  ...base,
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    ...base.test,
    include: ['*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
};
