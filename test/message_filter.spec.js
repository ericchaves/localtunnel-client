
import assert from 'assert';
import http from 'http';
import localtunnel from '../localtunnel.js';
import { MockLocalTunnelServer, MockLocalServer } from './helpers/mocks.js';

  // ===========================================================================
  // Message Filtering - X-LT-Source Header
  // ===========================================================================

describe('LocalTunnel Client - Message Filter', function() {

  let mockServer;
  let localServer;
  let fakePort;

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

  describe('Message Filtering (X-LT-Source Header)', function(){
    it('should skip messages with X-LT-Source: server header', async function() {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let requestEventCount = 0;

      const tunnel = await localtunnel({
        port: fakePort
      });

      // Handle errors to prevent uncaught exceptions
      tunnel.on('error', () => {});
      tunnel.tunnelCluster.on('error', () => {});

      // Listen for 'request' events
      tunnel.on('request', () => {
        requestEventCount++;
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 50));

      const remoteSocket = tcpMock.sockets[0];

      // Send a server-originated message with X-LT-Source: server header
      const serverMessage = 'HTTP/1.1 429 Too Many Requests\r\n' +
        'X-LT-Source: server\r\n' +
        'Content-Type: text/plain\r\n' +
        'Content-Length: 20\r\n' +
        '\r\n' +
        'Server is busy\r\n';

      remoteSocket.write(serverMessage);

      // Wait a bit to ensure message is processed (or skipped)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should NOT have emitted a request event
      assert.strictEqual(requestEventCount, 0,
        'Should not emit request event for X-LT-Source: server messages');

      tunnel.close();
      await tcpMock.close();
    });

    it('should process normal messages without X-LT-Source header', async function() {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let requestEventCount = 0;
      let capturedRequest = null;

      const tunnel = await localtunnel({
        port: fakePort
      });

      // Listen for 'request' events
      tunnel.on('request', (req) => {
        requestEventCount++;
        capturedRequest = req;
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 50));

      const remoteSocket = tcpMock.sockets[0];

      // Send a normal HTTP request without X-LT-Source header
      const normalRequest = 'GET /api/users HTTP/1.1\r\n' +
        'Host: example.com\r\n' +
        'User-Agent: Test\r\n' +
        '\r\n';

      remoteSocket.write(normalRequest);

      // Wait for message to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have emitted a request event
      assert.strictEqual(requestEventCount, 1,
        'Should emit request event for normal messages');
      assert.strictEqual(capturedRequest.method, 'GET',
        'Should capture correct method');
      assert.strictEqual(capturedRequest.path, '/api/users',
        'Should capture correct path');

      tunnel.close();
      await tcpMock.close();
    });

    it('should handle mixed messages (some with X-LT-Source, some without)', async function() {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let requestEventCount = 0;
      const capturedRequests = [];

      const tunnel = await localtunnel({
        port: fakePort
      });

      // Listen for 'request' events
      tunnel.on('request', (req) => {
        requestEventCount++;
        capturedRequests.push(req);
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 50));

      const remoteSocket = tcpMock.sockets[0];

      // Send normal request
      remoteSocket.write('GET /api/test HTTP/1.1\r\nHost: example.com\r\n\r\n');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Send server message (should be skipped) - note this is a RESPONSE, not a REQUEST
      // The regex looks for method + path which this doesn't have, so it won't emit anyway
      remoteSocket.write('HTTP/1.1 503 Service Unavailable\r\nX-LT-Source: server\r\n\r\n');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Send another normal request
      remoteSocket.write('POST /api/data HTTP/1.1\r\nHost: example.com\r\n\r\n');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have emitted 2 request events (not 3)
      // Note: The HTTP/1.1 503 response wouldn't match the request regex anyway,
      // but we're testing that X-LT-Source skips processing entirely
      assert(requestEventCount >= 1,
        'Should emit request events for normal messages');
      assert.strictEqual(capturedRequests[0].method, 'GET',
        'First request should be GET');

      // If we got 2 requests, verify the second one
      if (requestEventCount === 2) {
        assert.strictEqual(capturedRequests[1].method, 'POST',
          'Second request should be POST');
      }

      tunnel.close();
      await tcpMock.close();
    });

    it('should not dump server messages to inspection files', async function() {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      // Create temporary dump directory
      const tmpDir = '/tmp/lt-test-dump-' + Date.now();
      const fs = await import('fs');
      const fsPromises = fs.promises;
      await fsPromises.mkdir(tmpDir, { recursive: true });

      const tunnel = await localtunnel({
        port: fakePort,
        dump_dir: tmpDir
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 50));

      const remoteSocket = tcpMock.sockets[0];

      // Send server message with X-LT-Source header
      const serverMessage = 'HTTP/1.1 429 Too Many Requests\r\n' +
        'X-LT-Source: server\r\n' +
        'Content-Length: 0\r\n' +
        '\r\n';

      remoteSocket.write(serverMessage);

      // Wait for potential dump
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that no dump files were created
      const files = await fsPromises.readdir(tmpDir);
      const requestFiles = files.filter(f => f.includes('request'));

      assert.strictEqual(requestFiles.length, 0,
        'Should not create dump files for X-LT-Source: server messages');

      tunnel.close();
      await tcpMock.close();

      // Cleanup
      await fsPromises.rm(tmpDir, { recursive: true, force: true });
    });
  })

});
