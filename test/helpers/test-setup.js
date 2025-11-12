/**
 * Shared Test Utilities
 * Common helpers and setup functions for LocalTunnel Client tests
 */

import http from 'http';
import { MockLocalTunnelServer, MockLocalServer } from './mocks.js';

/**
 * Helper to properly close HTTP servers
 * Ensures all connections are closed before shutting down
 */
export function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) {
      resolve();
      return;
    }
    // Force close all connections first
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

/**
 * Creates a basic HTTP server for testing
 * The server echoes back the Host header in the response
 *
 * @returns {Promise<{server: http.Server, port: number}>}
 */
export function createFakeHttpServer() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.on('request', (req, res) => {
      res.write(req.headers.host);
      res.end();
    });
    server.listen(() => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

/**
 * Common setup pattern for tests
 * Creates mock tunnel server and local server instances
 *
 * @param {number} fakePort - Port of the local HTTP server
 * @returns {{mockServer: MockLocalTunnelServer, localServer: MockLocalServer}}
 */
export function setupMockServers(fakePort) {
  const mockServer = new MockLocalTunnelServer({
    baseUrl: 'https://localtunnel.me',
    domain: 'localtunnel.me'
  });

  const localServer = new MockLocalServer(fakePort);

  return { mockServer, localServer };
}

/**
 * Common cleanup pattern for tests
 * Cleans up mock servers after test execution
 *
 * @param {MockLocalTunnelServer} mockServer
 * @param {MockLocalServer} localServer
 */
export async function cleanupMockServers(mockServer, localServer) {
  if (mockServer) {
    await mockServer.cleanup();
  }
  if (localServer) {
    await localServer.stop();
  }
}
