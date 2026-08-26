import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['server/test/**/*.vitest.test.js'], testTimeout: 30000 } });
