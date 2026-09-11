import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'services/api-gateway/vitest.config.ts',
      'services/build-server/vitest.config.ts',
      'services/log-service/vitest.config.ts',
      'services/reverse-proxy/vitest.config.ts',
    ],
  },
});
