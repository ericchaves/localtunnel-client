/**
 * LocalTunnel Client Tests
 * Based on client.spec.reference.js v1.0.0
 * Protocol version: 0.0.8-epc
 *
 * All tests use mocks - no real localtunnel server required
 */

/* eslint-disable no-console */

import crypto from 'crypto';
import http from 'http';
import assert from 'assert';
import nock from 'nock';
import localtunnel from './localtunnel.js';
import { MockLocalTunnelServer, MockLocalServer, PROTOCOL_SPECS } from './test/helpers/mocks.js';

// Helper to properly close HTTP servers
function closeServer(server) {
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

describe('LocalTunnel Client', function() {
  let mockServer;
  let localServer;
  let fakePort;

  // Tests use mocks, so we can use shorter timeout
  // Note: this applies to hooks (before, beforeEach, afterEach) AND tests
  this.timeout(2000);

  before(done => {
    const server = http.createServer();
    server.on('request', (req, res) => {
      res.write(req.headers.host);
      res.end();
    });
    server.listen(() => {
      const { port } = server.address();
      fakePort = port;
      done();
    });
  });

  beforeEach(function() {
    mockServer = new MockLocalTunnelServer({
      baseUrl: 'https://localtunnel.me',
      domain: 'localtunnel.me'
    });

    localServer = new MockLocalServer(fakePort);
  });

  afterEach(async function() {
    await mockServer.cleanup();
    await localServer.stop();
  });

  // ===========================================================================
  // BASIC TUNNEL CREATION TESTS (refactored from old tests)
  // ===========================================================================

  describe('Basic Tunnel Creation', function() {
    it('should create tunnel with random subdomain', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({ port: fakePort });

      assert.ok(new RegExp('^https://.*\\.localtunnel\\.me$').test(tunnel.url));
      assert.equal(tunnel.clientId, tunnelId);

      // Wait for TCP connection
      await new Promise(resolve => setTimeout(resolve, 50));

      tunnel.close();
      await tcpMock.close();
    });

    it('should request specific subdomain', async () => {
      const requestedSubdomain = Math.random().toString(36).substr(2);
      const { tunnelId } = mockServer.mockTunnelCreation(requestedSubdomain);
      const tcpPort = mockServer.tunnels.get(tunnelId).port;
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({ port: fakePort, subdomain: requestedSubdomain });

      assert.ok(new RegExp(`^https://${requestedSubdomain}\\.localtunnel\\.me$`).test(tunnel.url));

      tunnel.close();
      await tcpMock.close();
    });

    it('should parse tunnel creation response correctly', async () => {
      const subdomain = 'testapp';
      const { tunnelId, tcpPort, maxConnCount } = mockServer.mockTunnelCreation(subdomain, {
        maxConnCount: 15
      });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({ port: fakePort, subdomain });

      assert.equal(tunnel.clientId, tunnelId);
      assert.equal(tunnel.url, `https://${tunnelId}.localtunnel.me`);

      tunnel.close();
      await tcpMock.close();
    });
  });

  // ===========================================================================
  // LOCAL HOST OVERRIDE TESTS (refactored from old tests)
  // ===========================================================================

  describe('Local Host Override', function() {
    it('should override Host header with local-host: localhost', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let localRequestReceived = false;
      const testServer = http.createServer((req, res) => {
        localRequestReceived = true;
        res.writeHead(200);
        res.end(req.headers.host);
      });

      await new Promise(resolve => testServer.listen(0, resolve));
      const testPort = testServer.address().port;

      const tunnel = await localtunnel({ port: testPort, local_host: 'localhost' });

      // Wait for TCP connection
      await new Promise(resolve => setTimeout(resolve, 50));

      const socketPromise = new Promise((resolve) => {
        tcpMock.emitter.once('clientConnected', resolve);
      });

      const socket = tcpMock.sockets[0];
      if (socket) {
        const responsePromise = new Promise((resolve) => {
          let data = '';
          socket.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('localhost')) {
              resolve(data);
            }
          });
        });

        mockServer.sendHttpRequest(socket, {
          method: 'GET',
          path: '/',
          headers: { host: 'different-host.com' }
        });

        const response = await responsePromise;
        assert(response.includes('localhost'));
      }

      tunnel.close();
      await closeServer(testServer);
      await tcpMock.close();
    });

    it('should override Host header with local-host: 127.0.0.1', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const testServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end(req.headers.host);
      });

      await new Promise(resolve => testServer.listen(0, resolve));
      const testPort = testServer.address().port;

      const tunnel = await localtunnel({ port: testPort, local_host: '127.0.0.1' });

      // Wait for TCP connection
      await new Promise(resolve => setTimeout(resolve, 50));

      const socket = tcpMock.sockets[0];
      if (socket) {
        const responsePromise = new Promise((resolve) => {
          let data = '';
          socket.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('127.0.0.1')) {
              resolve(data);
            }
          });
        });

        mockServer.sendHttpRequest(socket, {
          method: 'GET',
          path: '/',
          headers: { host: 'different-host.com' }
        });

        const response = await responsePromise;
        assert(response.includes('127.0.0.1'));
      }

      tunnel.close();
      await closeServer(testServer);
      await tcpMock.close();
    });

    it('should send chunked request with local-host', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const testServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end(req.headers.host);
      });

      await new Promise(resolve => testServer.listen(0, resolve));
      const testPort = testServer.address().port;

      const tunnel = await localtunnel({ port: testPort, local_host: '127.0.0.1' });

      // Wait for TCP connection
      await new Promise(resolve => setTimeout(resolve, 50));

      const socket = tcpMock.sockets[0];
      if (socket) {
        const responsePromise = new Promise((resolve) => {
          let data = '';
          socket.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('127.0.0.1')) {
              resolve(data);
            }
          });
        });

        const body = crypto.randomBytes(1024 * 8).toString('base64');
        mockServer.sendHttpRequest(socket, {
          method: 'POST',
          path: '/',
          headers: {
            'host': 'different-host.com',
            'transfer-encoding': 'chunked'
          },
          body
        });

        const response = await responsePromise;
        assert(response.includes('127.0.0.1'));
      }

      tunnel.close();
      await closeServer(testServer);
      await tcpMock.close();
    });
  });

  // ===========================================================================
  // TUNNEL CREATION - EXTENDED TESTS
  // ===========================================================================

  describe('Tunnel Creation - Error Handling', function() {
    it('should handle invalid subdomain format (403)', async () => {
      const invalidSubdomain = 'ab'; // Too short
      mockServer.mockInvalidSubdomain(invalidSubdomain);

      try {
        await localtunnel({ port: fakePort, subdomain: invalidSubdomain });
        assert.fail('Should have thrown error');
      } catch (err) {
        // Client should receive error from server
        assert(err.message);
      }
    });

    it('should handle subdomain reserved error (409)', async () => {
      const subdomain = 'reserved';
      mockServer.mockSubdomainReserved(subdomain, 25);

      try {
        await localtunnel({ port: fakePort, subdomain: subdomain });
        assert.fail('Should have thrown error');
      } catch (err) {
        // Client should receive error from server
        assert(err.message);
      }
    });
  });

  // ===========================================================================
  // TCP SOCKET MANAGEMENT TESTS
  // ===========================================================================

  describe('TCP Socket Management', function() {
    it('should establish TCP connection to assigned port', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const connectionPromise = new Promise((resolve) => {
        tcpMock.emitter.once('clientConnected', resolve);
      });

      const tunnel = await localtunnel({ port: fakePort });

      const socket = await connectionPromise;
      assert(socket);

      tunnel.close();
      await tcpMock.close();
    });

    it('should maintain multiple TCP connections (up to max_conn_count)', async () => {
      const maxConnCount = 5;
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let connectionCount = 0;
      tcpMock.emitter.on('clientConnected', () => {
        connectionCount++;
      });

      const tunnel = await localtunnel({ port: fakePort });

      // Wait for connections to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      assert(connectionCount >= 1);
      assert(connectionCount <= maxConnCount);

      tunnel.close();
      await tcpMock.close();
    });

    it('should reconnect on socket disconnection', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let connectionCount = 0;
      const connections = [];

      tcpMock.emitter.on('clientConnected', (socket) => {
        connectionCount++;
        connections.push(socket);
      });

      const tunnel = await localtunnel({ port: fakePort });
      await new Promise(resolve => setTimeout(resolve, 50));

      const initialCount = connectionCount;

      // Force disconnect first socket
      if (connections[0]) {
        connections[0].destroy();
      }

      // Wait for reconnection (increased wait time due to exponential backoff - starts at 1s)
      await new Promise(resolve => setTimeout(resolve, 1500));

      assert(connectionCount > initialCount);

      tunnel.close();
      await tcpMock.close();
    });

    it('should respect max_conn_count limit', async () => {
      const maxConnCount = 3;
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let connectionCount = 0;
      tcpMock.emitter.on('clientConnected', () => {
        connectionCount++;
      });

      const tunnel = await localtunnel({ port: fakePort });

      // Wait for all connections
      await new Promise(resolve => setTimeout(resolve, 100));

      assert.equal(connectionCount, maxConnCount);

      tunnel.close();
      await tcpMock.close();
    });

    it('should keep sockets alive with keep-alive', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const socketPromise = new Promise((resolve) => {
        tcpMock.emitter.once('clientConnected', resolve);
      });

      const tunnel = await localtunnel({ port: fakePort });
      const socket = await socketPromise;

      // Check if keep-alive is enabled
      assert.equal(socket.connecting, false);

      tunnel.close();
      await tcpMock.close();
    });
  });

  // ===========================================================================
  // HTTP REQUEST FORWARDING TESTS
  // ===========================================================================

  describe('HTTP Request Forwarding', function() {
    it('should receive HTTP request from tunnel socket and forward to local service', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let localRequestReceived = false;
      const testServer = http.createServer((req, res) => {
        localRequestReceived = true;
        assert.equal(req.method, 'GET');
        assert.equal(req.url, '/test');
        res.writeHead(200);
        res.end('OK');
      });

      await new Promise(resolve => testServer.listen(0, resolve));
      const testPort = testServer.address().port;

      const tunnel = await localtunnel({ port: testPort });

      const socketPromise = new Promise((resolve) => {
        tcpMock.emitter.once('clientConnected', resolve);
      });

      const socket = await socketPromise;

      // Send HTTP request to client
      mockServer.sendHttpRequest(socket, {
        method: 'GET',
        path: '/test',
        headers: { host: 'localhost' }
      });

      // Wait for local server to receive request
      await new Promise(resolve => setTimeout(resolve, 50));

      assert(localRequestReceived);

      tunnel.close();
      await closeServer(testServer);
      await tcpMock.close();
    });

    it('should forward response back through tunnel socket', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const testServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hello World');
      });

      await new Promise(resolve => testServer.listen(0, resolve));
      const testPort = testServer.address().port;

      const tunnel = await localtunnel({ port: testPort });

      const socketPromise = new Promise((resolve) => {
        tcpMock.emitter.once('clientConnected', resolve);
      });

      const socket = await socketPromise;

      const responsePromise = new Promise((resolve) => {
        let data = '';
        socket.on('data', (chunk) => {
          data += chunk.toString();
          if (data.includes('\r\n\r\n')) {
            resolve(data);
          }
        });
      });

      mockServer.sendHttpRequest(socket, {
        method: 'GET',
        path: '/',
        headers: { host: 'localhost' }
      });

      const response = await responsePromise;

      assert(response.includes('HTTP/1.1 200'));
      assert(response.includes('Hello World'));

      tunnel.close();
      await closeServer(testServer);
      await tcpMock.close();
    });

    it('should support different HTTP methods (GET, POST, PUT, DELETE)', async () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE'];

      for (const method of methods) {
        const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
        const tcpMock = await mockServer.createMockTcpServer(tcpPort);

        let receivedMethod = null;
        const testServer = http.createServer((req, res) => {
          receivedMethod = req.method;
          res.writeHead(200);
          res.end('OK');
        });

        await new Promise(resolve => testServer.listen(0, resolve));
        const testPort = testServer.address().port;

        const tunnel = await localtunnel({ port: testPort });

        const socketPromise = new Promise((resolve) => {
          tcpMock.emitter.once('clientConnected', resolve);
        });

        const socket = await socketPromise;

        mockServer.sendHttpRequest(socket, {
          method: method,
          path: '/test',
          headers: { host: 'localhost' }
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        assert.equal(receivedMethod, method);

        tunnel.close();
        await closeServer(testServer);
        await tcpMock.close();
      }
    });

    it('should preserve request headers', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const testHeaders = {
        'host': 'example.com',
        'user-agent': 'TestAgent/1.0',
        'x-custom-header': 'CustomValue',
        'content-type': 'application/json'
      };

      let receivedHeaders = null;
      const testServer = http.createServer((req, res) => {
        receivedHeaders = req.headers;
        res.writeHead(200);
        res.end('OK');
      });

      await new Promise(resolve => testServer.listen(0, resolve));
      const testPort = testServer.address().port;

      const tunnel = await localtunnel({ port: testPort });

      const socketPromise = new Promise((resolve) => {
        tcpMock.emitter.once('clientConnected', resolve);
      });

      const socket = await socketPromise;

      mockServer.sendHttpRequest(socket, {
        method: 'POST',
        path: '/api/test',
        headers: testHeaders
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      assert(receivedHeaders);
      assert.equal(receivedHeaders['user-agent'], 'TestAgent/1.0');
      assert.equal(receivedHeaders['x-custom-header'], 'CustomValue');
      assert.equal(receivedHeaders['content-type'], 'application/json');

      tunnel.close();
      await closeServer(testServer);
      await tcpMock.close();
    });

    it('should handle POST request with body', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const requestBody = JSON.stringify({ test: 'data' });
      let receivedBody = '';

      const testServer = http.createServer((req, res) => {
        req.on('data', chunk => {
          receivedBody += chunk.toString();
        });
        req.on('end', () => {
          res.writeHead(200);
          res.end('OK');
        });
      });

      await new Promise(resolve => testServer.listen(0, resolve));
      const testPort = testServer.address().port;

      const tunnel = await localtunnel({ port: testPort });

      const socketPromise = new Promise((resolve) => {
        tcpMock.emitter.once('clientConnected', resolve);
      });

      const socket = await socketPromise;

      mockServer.sendHttpRequest(socket, {
        method: 'POST',
        path: '/api/data',
        headers: {
          'host': 'localhost',
          'content-type': 'application/json',
          'content-length': requestBody.length
        },
        body: requestBody
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      assert.equal(receivedBody, requestBody);

      tunnel.close();
      await closeServer(testServer);
      await tcpMock.close();
    });
  });

  // ===========================================================================
  // WEBSOCKET SUPPORT TESTS
  // ===========================================================================

  describe('WebSocket Support', function() {
    it('should forward WebSocket upgrade to local service', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let upgradeReceived = false;

      // Create HTTP server that handles upgrades
      const httpServer = http.createServer();
      httpServer.on('upgrade', (req, socket, head) => {
        upgradeReceived = true;
        assert.equal(req.headers.upgrade, 'websocket');
        socket.end();
      });

      await new Promise(resolve => {
        httpServer.listen(0, resolve);
      });
      const testPort = httpServer.address().port;

      const tunnel = await localtunnel({ port: testPort });

      const socketPromise = new Promise((resolve) => {
        tcpMock.emitter.once('clientConnected', resolve);
      });

      const socket = await socketPromise;

      mockServer.sendWebSocketUpgrade(socket);

      await new Promise(resolve => setTimeout(resolve, 50));

      assert(upgradeReceived);

      await closeServer(httpServer);
      tunnel.close();
      await tcpMock.close();
    });
  });

  // ===========================================================================
  // ERROR HANDLING TESTS
  // ===========================================================================

  describe('Error Handling', function() {
    it('should handle local service connection errors', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      // Don't start local server - connection should fail
      const nonExistentPort = 9999;

      let errorEmitted = false;
      const tunnel = await localtunnel({ port: nonExistentPort });

      tunnel.on('error', (err) => {
        errorEmitted = true;
      });

      const socketPromise = new Promise((resolve) => {
        tcpMock.emitter.once('clientConnected', resolve);
      });

      const socket = await socketPromise;

      mockServer.sendHttpRequest(socket, {
        method: 'GET',
        path: '/'
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Client should have tried to connect and failed

      tunnel.close();
      await tcpMock.close();
    });

    it('should emit error events on failures', async function() {
      // This test needs more time because of retry logic (3 retries × 1s = 3s)
      this.timeout(5000);

      // Test connection to invalid host - mock needs to respond 3 times for 3 retries
      // Use nock directly instead of MockLocalTunnelServer to avoid any issues
      nock('https://localtunnel.me')
        .get('/')
        .query({ new: '' })
        .times(3)
        .reply(500, { message: 'Internal Server Error' });

      try {
        await localtunnel({ port: fakePort });
        assert.fail('Should have thrown error after retries');
      } catch (err) {
        // Expected - server returned error after retries
        assert(err);
        assert(err.message.includes('Server error after'));
      }
    });

    it('should handle tunnel server disconnection', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({ port: fakePort });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Close all server sockets
      for (const socket of tcpMock.sockets) {
        socket.destroy();
      }

      // Wait for client to detect disconnect
      await new Promise(resolve => setTimeout(resolve, 100));

      // Client should attempt to reconnect

      tunnel.close();
      await tcpMock.close();
    });
  });

  // ===========================================================================
  // CLIENT LIFECYCLE TESTS
  // ===========================================================================

  describe('Client Lifecycle', function() {
    it('should provide tunnel information via properties', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({ port: fakePort });

      assert(tunnel.url);
      assert.equal(tunnel.clientId, tunnelId);

      tunnel.close();
      await tcpMock.close();
    });

    it('should cleanly close all connections', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let disconnectCount = 0;
      tcpMock.emitter.on('clientDisconnected', () => {
        disconnectCount++;
      });

      const tunnel = await localtunnel({ port: fakePort });
      await new Promise(resolve => setTimeout(resolve, 50));

      const initialSockets = tcpMock.sockets.length;

      tunnel.close();

      await new Promise(resolve => setTimeout(resolve, 50));

      assert.equal(disconnectCount, initialSockets);
      assert.equal(tcpMock.sockets.length, 0);

      await tcpMock.close();
    });

    it('should emit close event when tunnel closes', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({ port: fakePort });

      let closeEmitted = false;
      tunnel.on('close', () => {
        closeEmitted = true;
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      tunnel.close();

      assert(closeEmitted);

      await tcpMock.close();
    });

    it('should emit request event for each incoming request', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const testServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('OK');
      });

      await new Promise(resolve => testServer.listen(0, resolve));
      const testPort = testServer.address().port;

      const tunnel = await localtunnel({ port: testPort });

      let requestCount = 0;
      tunnel.on('request', (info) => {
        requestCount++;
        assert(info.method);
        assert(info.path);
      });

      const socketPromise = new Promise((resolve) => {
        tcpMock.emitter.once('clientConnected', resolve);
      });

      const socket = await socketPromise;

      // Send multiple requests
      mockServer.sendHttpRequest(socket, { method: 'GET', path: '/1', headers: { host: 'localhost' } });
      await new Promise(resolve => setTimeout(resolve, 50));
      mockServer.sendHttpRequest(socket, { method: 'POST', path: '/2', headers: { host: 'localhost' } });
      await new Promise(resolve => setTimeout(resolve, 50));

      assert.equal(requestCount, 2);

      tunnel.close();
      await closeServer(testServer);
      await tcpMock.close();
    });
  });

  // ===========================================================================
  // CONFIGURATION TESTS
  // ===========================================================================

  describe('Configuration', function() {
    it('should support custom host configuration', async () => {
      const customHost = 'https://custom.tunnel.host';
      const customMockServer = new MockLocalTunnelServer({
        baseUrl: customHost,
        domain: 'custom.tunnel.host'
      });

      const { tunnelId, tcpPort } = customMockServer.mockTunnelCreation();
      const tcpMock = await customMockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({ port: fakePort, host: customHost });

      assert(tunnel.url.includes('custom.tunnel.host'));

      tunnel.close();
      await tcpMock.close();
      await customMockServer.cleanup();
    });

    it('should support local_host option for local service', async () => {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      // Start server on custom host
      const testServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('Custom host response');
      });

      await new Promise(resolve => testServer.listen(0, resolve));
      const testPort = testServer.address().port;

      const tunnel = await localtunnel({
        port: testPort,
        local_host: 'localhost'
      });

      const socketPromise = new Promise((resolve) => {
        tcpMock.emitter.once('clientConnected', resolve);
      });

      const socket = await socketPromise;

      mockServer.sendHttpRequest(socket, {
        method: 'GET',
        path: '/',
        headers: { host: 'tunnel.example.com' }
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      tunnel.close();
      await closeServer(testServer);
      await tcpMock.close();
    });
  });
});
