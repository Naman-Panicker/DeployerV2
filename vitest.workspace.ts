import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'services/api-gateway/vitest.config.ts',
  'services/build-server/vitest.config.ts',
  'services/log-service/vitest.config.ts',
  'services/reverse-proxy/vitest.config.ts',
  'services/upload-service/vitest.config.ts',
]);
