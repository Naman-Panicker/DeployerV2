import { Server, ServerCredentials } from '@grpc/grpc-js';
import { BuildServiceService, type BuildServiceServer } from '@deployer/proto';
import { handleTriggerBuild } from './handlers/build.handler.js';
import { handleGetBuildStatus } from './handlers/status.handler.js';
import { ensureBuildImage } from './services/docker.service.js';

export function createGrpcServer(): Server {
  const server = new Server();

  const implementation: BuildServiceServer = {
    triggerBuild: handleTriggerBuild,
    getBuildStatus: handleGetBuildStatus,
  };

  server.addService(BuildServiceService, implementation);
  return server;
}

export async function startServer(port: number): Promise<Server> {
  // Pre-pull / verify build container image on startup
  await ensureBuildImage().catch((err) => {
    console.warn('[Build Server] Warning: Could not verify Docker build image on startup:', err.message);
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
      console.log(`[Build Server] gRPC server running on 0.0.0.0:${boundPort}`);
      console.log(`[Build Server] RPCs available: TriggerBuild, GetBuildStatus`);
      console.log(`========================================================`);

      resolve(server);
    });
  });
}
