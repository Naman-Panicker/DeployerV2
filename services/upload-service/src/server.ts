import { Server, ServerCredentials } from '@grpc/grpc-js';
import { UploadServiceService, type UploadServiceServer } from '@deployer/proto';
import { handleCloneRepo } from './handlers/clone.handler.js';
import { handleUploadArtifacts, handleCopyArtifacts } from './handlers/upload.handler.js';
import { initializeBucket } from './services/s3.service.js';

export function createGrpcServer(): Server {
  const server = new Server();

  const implementation: UploadServiceServer = {
    cloneRepo: handleCloneRepo,
    uploadArtifacts: handleUploadArtifacts,
    copyArtifacts: handleCopyArtifacts,
  };

  server.addService(UploadServiceService, implementation);

  return server;
}

export async function startServer(port: number): Promise<Server> {
  // Check or initialize S3 bucket
  await initializeBucket().catch((err) => {
    console.warn('[Upload Service] S3 bucket check warning:', err);
  });

  const server = createGrpcServer();
  const bindAddress = `0.0.0.0:${port}`;

  return new Promise((resolve, reject) => {
    server.bindAsync(bindAddress, ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) {
        reject(err);
        return;
      }

      console.log(`========================================================`);
      console.log(`[Upload Service] gRPC server running on 0.0.0.0:${boundPort}`);
      console.log(`[Upload Service] RPCs available: CloneRepo, UploadArtifacts, CopyArtifacts`);
      console.log(`========================================================`);

      resolve(server);
    });
  });
}
