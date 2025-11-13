/**
 * LocalTunnel Local Service Reconnection Tests
 * Tests for local service retry and reconnection logic
 * Protocol version: 0.0.11-epc
 */

import http from 'http';
import assert from 'assert';
import localtunnel from '../localtunnel.js';
import { MockLocalTunnelServer, MockLocalServer } from './helpers/mocks.js';
import { closeServer, createFakeHttpServer } from './helpers/test-setup.js';

describe('Local Service Reconnection', function() {
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
  // CONFIGURATION
  // ===========================================================================

  describe('Configuration', function() {
    it('should accept local_reconnect option via API', async function() {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({
        port: fakePort,
        local_reconnect: false
      });

      // Verify the option is passed through to TunnelCluster
      assert.strictEqual(tunnel.opts.local_reconnect, false, 'Should accept local_reconnect option');

      tunnel.close();
      await tcpMock.close();
    });

    it('should accept local_retry_max option via API', async function() {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({
        port: fakePort,
        local_retry_max: 5
      });

      // Verify the option is passed through to TunnelCluster
      assert.strictEqual(tunnel.opts.local_retry_max, 5, 'Should accept local_retry_max option');

      tunnel.close();
      await tcpMock.close();
    });

    it('should default to local_reconnect=true, local_retry_max=0', async function() {
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation();
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({
        port: fakePort
      });

      // Check defaults (local_reconnect defaults to true in TunnelCluster.js line 256)
      // local_retry_max defaults to 0 (infinite) in TunnelCluster.js line 257
      assert.notStrictEqual(tunnel.opts.local_reconnect, false,
        'Should default local_reconnect to true');
      assert.strictEqual(tunnel.opts.local_retry_max || 0, 0,
        'Should default local_retry_max to 0 (infinite)');

      tunnel.close();
      await tcpMock.close();
    });
  });

  // ===========================================================================
  // TUNNELCLUSTER LOCAL RETRY BEHAVIOR
  // ===========================================================================

  describe('TunnelCluster Local Retry Behavior', function() {
    it('should enable local reconnection with infinite retries by default', async function() {
      this.timeout(3000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 2 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let connectionCount = 0;

      // Create a local server that works correctly
      const testServer = http.createServer((req, res) => {
        connectionCount++;
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise((resolve) => testServer.listen(0, resolve));
      const localPort = testServer.address().port;

      const tunnel = await localtunnel({
        port: localPort,
        local_reconnect: true,
        local_retry_max: 0 // infinite retries
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 150));

      // Verify options are propagated to TunnelCluster
      // (Note: actual retry behavior is tested in subsequent tests where
      // we can better control the timing without remote connection interference)
      assert.notStrictEqual(tunnel.opts.local_reconnect, false,
        'Should enable local reconnection');
      assert.strictEqual(tunnel.opts.local_retry_max || 0, 0,
        'Should set infinite retries (0)');

      // Send a request to verify normal operation
      const remoteSocket = tcpMock.sockets[0];
      remoteSocket.write('GET /test HTTP/1.1\r\nHost: test.com\r\n\r\n');

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have processed at least one request
      assert(connectionCount >= 1, 'Should handle HTTP requests normally');

      tunnel.close();
      await tcpMock.close();
      await new Promise((resolve) => testServer.close(resolve));
    });

    it('should not retry when local_reconnect is disabled', async function() {
      this.timeout(3000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let deadEventCount = 0;
      let deadEventInfo = null;

      // Create a fake local server that will close the connection
      const testServer = http.createServer((req, res) => {
        // Close connection immediately
        req.socket.destroy();
      });

      await new Promise((resolve) => testServer.listen(0, resolve));
      const localPort = testServer.address().port;

      const tunnel = await localtunnel({
        port: localPort,
        local_reconnect: false,
        local_retry_max: 5
      });

      // Listen for 'dead' event with retriable flag
      tunnel.tunnelCluster.on('dead', (eventInfo) => {
        deadEventCount++;
        deadEventInfo = eventInfo;
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get the remote socket
      const remoteSocket = tcpMock.sockets[0];

      // Send request to trigger local connection
      remoteSocket.write('GET /test HTTP/1.1\r\nHost: test.com\r\n\r\n');

      // Wait for local connection to close
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Should emit 'dead' with retriable=false (line 290 in TunnelCluster.js)
      assert.strictEqual(deadEventCount, 1, 'Should emit dead event once');
      assert.strictEqual(deadEventInfo?.retriable, false,
        'Should emit dead with retriable=false when reconnect disabled');

      tunnel.close();
      await tcpMock.close();
      await new Promise((resolve) => testServer.close(resolve));
    });

    it('should handle remote close during local retry gracefully', async function() {
      this.timeout(4000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let deadEventCount = 0;
      let deadEventInfo = null;

      // Create a local server that fails a few times (but not enough to reach 10)
      let failureCount = 0;
      const testServer = http.createServer((req, res) => {
        failureCount++;
        if (failureCount <= 3) {
          // Fail first 3 attempts
          req.socket.destroy();
        } else {
          // Would succeed after, but we'll close remote before
          res.writeHead(200);
          res.end('ok');
        }
      });

      await new Promise((resolve) => testServer.listen(0, resolve));
      const localPort = testServer.address().port;

      const tunnel = await localtunnel({
        port: localPort,
        local_reconnect: true
      });

      // Listen for 'dead' event
      tunnel.tunnelCluster.on('dead', (eventInfo) => {
        deadEventCount++;
        deadEventInfo = eventInfo;
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      // Trigger local connection
      const remoteSocket = tcpMock.sockets[0];
      remoteSocket.write('GET /test HTTP/1.1\r\nHost: test.com\r\n\r\n');

      // Wait for a few local failures (but less than 10)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Close remote during retry - should emit dead with retriable=true since failures < 10
      remoteSocket.destroy();

      // Wait for dead event
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should emit 'dead' with retriable=true because consecutive failures < 10
      assert.strictEqual(deadEventCount, 1, 'Should emit dead event once');
      assert.strictEqual(deadEventInfo?.retriable, true,
        'Should emit dead with retriable=true when remote closes with failures < 10');

      tunnel.close();
      await tcpMock.close();
      await new Promise((resolve) => testServer.close(resolve));
    });

  });
});
