/**
 * LocalTunnel HTTP Forwarding Tests
 * Tests for HTTP protocol handling and forwarding behavior
 * Protocol version: 0.0.8-epc
 */

import crypto from 'crypto';
import http from 'http';
import assert from 'assert';
import localtunnel from '../localtunnel.js';
import { MockLocalTunnelServer, MockLocalServer } from './helpers/mocks.js';
import { closeServer, createFakeHttpServer } from './helpers/test-setup.js';

describe('HTTP Forwarding', function() {
  let mockServer;
  let localServer;
  let fakePort;

  this.timeout(2000);

  before(async () => {
    const { server, port } = await createFakeHttpServer();
    fakePort = port;
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
  // HTTP REQUEST FORWARDING
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

    it('should forward WebSocket upgrade requests', async () => {
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
  // LOCAL HOST OVERRIDE
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
});
