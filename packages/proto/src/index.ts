// Namespaced exports
export * as buildProto from './generated/build.js';

// Build service exports
export {
  BuildServiceClient,
  BuildServiceServer,
  BuildServiceService,
  TriggerBuildRequest,
  TriggerBuildResponse,
  GetBuildStatusRequest,
  GetBuildStatusResponse,
  CopyArtifactsRequest,
  CopyArtifactsResponse,
} from './generated/build.js';
