// Namespaced exports
export * as buildProto from './generated/build.js';
export * as uploadProto from './generated/upload.js';

// Build service exports
export {
  BuildServiceClient,
  BuildServiceServer,
  BuildServiceService,
  TriggerBuildRequest,
  TriggerBuildResponse,
  GetBuildStatusRequest,
  GetBuildStatusResponse,
} from './generated/build.js';

// Upload service exports
export {
  UploadServiceClient,
  UploadServiceServer,
  UploadServiceService,
  CloneRequest,
  CloneResponse,
  UploadRequest,
  UploadResponse,
} from './generated/upload.js';
