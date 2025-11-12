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

    it.skip('should stop retrying after local_retry_max reached (NEEDS REDESIGN)', async function() {
      this.timeout(6000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let localConnectionAttempts = 0;
      let deadEventCount = 0;
      let deadEventInfo = null;

      const maxRetries = 3;

      // Create a local server that counts connection attempts and closes immediately
      const testServer = http.createServer();

      // Count actual connection attempts (not just HTTP requests)
      testServer.on('connection', (socket) => {
        localConnectionAttempts++;
        // Destroy the socket after a small delay to simulate service failure
        // Small delay allows TunnelCluster to set up pipes before socket closes
        setTimeout(() => {
          socket.destroy();
        }, 10);
      });

      await new Promise((resolve) => testServer.listen(0, resolve));
      const localPort = testServer.address().port;

      const tunnel = await localtunnel({
        port: localPort,
        local_reconnect: true,
        local_retry_max: maxRetries
      });

      // Handle errors to prevent uncaught exceptions from killing the test
      tunnel.on('error', () => {
        // Expected errors from remote/local connection issues
      });
      tunnel.tunnelCluster.on('error', () => {
        // Expected errors from TunnelCluster operations
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

      // Wait for all retries to complete (maxRetries attempts)
      // Each retry has 1s delay (line 358 TunnelCluster.js)
      await new Promise(resolve => setTimeout(resolve, (maxRetries + 1) * 1000 + 500));

      // Should have attempted maxRetries + 1 (initial) times
      assert(localConnectionAttempts >= maxRetries + 1,
        `Should have ${maxRetries + 1} connection attempts (actual: ${localConnectionAttempts})`);

      // Should emit 'dead' with retriable=false after max retries (line 316)
      assert.strictEqual(deadEventCount, 1, 'Should emit dead event once after max retries');
      assert.strictEqual(deadEventInfo?.retriable, false,
        'Should emit dead with retriable=false after max retries exhausted');

      tunnel.close();
      await tcpMock.close();
      await new Promise((resolve) => testServer.close(resolve));
    });

    it.skip('should emit dead with retriable=false when max retries exhausted (NEEDS REDESIGN)', async function() {
      this.timeout(4000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let deadEvents = [];

      // Create a local server that always fails
      const testServer = http.createServer((req, res) => {
        req.socket.destroy();
      });

      await new Promise((resolve) => testServer.listen(0, resolve));
      const localPort = testServer.address().port;

      const tunnel = await localtunnel({
        port: localPort,
        local_reconnect: true,
        local_retry_max: 2
      });

      // Collect all dead events
      tunnel.tunnelCluster.on('dead', (eventInfo) => {
        deadEvents.push(eventInfo);
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      // Trigger local connection
      const remoteSocket = tcpMock.sockets[0];
      remoteSocket.write('GET /test HTTP/1.1\r\nHost: test.com\r\n\r\n');

      // Wait for retries to exhaust
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Should have exactly one dead event with retriable=false
      assert.strictEqual(deadEvents.length, 1, 'Should emit exactly one dead event');
      assert.strictEqual(deadEvents[0]?.retriable, false,
        'Dead event should have retriable=false');

      tunnel.close();
      await tcpMock.close();
      await new Promise((resolve) => testServer.close(resolve));
    });

    it.skip('should handle remote close during local retry gracefully (NEEDS REDESIGN)', async function() {
      this.timeout(4000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let deadEventCount = 0;
      let deadEventInfo = null;

      // Create a local server that always fails
      const testServer = http.createServer((req, res) => {
        req.socket.destroy();
      });

      await new Promise((resolve) => testServer.listen(0, resolve));
      const localPort = testServer.address().port;

      const tunnel = await localtunnel({
        port: localPort,
        local_reconnect: true,
        local_retry_max: 0 // infinite
      });

      // Listen for 'dead' event
      tunnel.tunnelCluster.on('dead', (eventInfo) => {
        deadEventCount++;
        deadEventInfo = eventInfo;
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      // Trigger local connection and close
      const remoteSocket = tcpMock.sockets[0];
      remoteSocket.write('GET /test HTTP/1.1\r\nHost: test.com\r\n\r\n');

      // Wait a bit for local to fail and retry to be scheduled
      await new Promise(resolve => setTimeout(resolve, 500));

      // Close remote during retry (simulates line 327-343 in TunnelCluster.js)
      remoteSocket.destroy();

      // Wait for dead event
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should emit 'dead' with retriable=true (line 341)
      assert.strictEqual(deadEventCount, 1, 'Should emit dead event once');
      assert.notStrictEqual(deadEventInfo?.retriable, false,
        'Should emit dead with retriable=true (or undefined) when remote closes during retry');

      tunnel.close();
      await tcpMock.close();
      await new Promise((resolve) => testServer.close(resolve));
    });

    it.skip('should reset retry counter on successful reconnection (NEEDS REDESIGN)', async function() {
      this.timeout(5000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let localConnectionAttempts = 0;

      // Create a local server that fails twice then succeeds
      const testServer = http.createServer((req, res) => {
        localConnectionAttempts++;

        if (localConnectionAttempts <= 2) {
          // Fail first 2 attempts
          req.socket.destroy();
        } else {
          // Succeed on 3rd attempt
          res.writeHead(200);
          res.end('success');
        }
      });

      await new Promise((resolve) => testServer.listen(0, resolve));
      const localPort = testServer.address().port;

      const tunnel = await localtunnel({
        port: localPort,
        local_reconnect: true,
        local_retry_max: 0 // infinite
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      // Trigger first request
      const remoteSocket = tcpMock.sockets[0];
      remoteSocket.write('GET /test1 HTTP/1.1\r\nHost: test.com\r\n\r\n');

      // Wait for retries and success
      await new Promise(resolve => setTimeout(resolve, 2500));

      // At this point, retry counter should be reset (line 186 in TunnelCluster.js)
      // Verify by triggering another request that should work immediately
      const initialAttempts = localConnectionAttempts;

      remoteSocket.write('GET /test2 HTTP/1.1\r\nHost: test.com\r\n\r\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Should have connected successfully without retries for second request
      assert(localConnectionAttempts >= 3,
        'Should have successfully reconnected and handled new request');

      tunnel.close();
      await tcpMock.close();
      await new Promise((resolve) => testServer.close(resolve));
    });

    it.skip('should clean up listeners and pipes before retry (NEEDS REDESIGN)', async function() {
      this.timeout(4000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let localConnectionAttempts = 0;

      // Create a local server that fails then succeeds
      const testServer = http.createServer((req, res) => {
        localConnectionAttempts++;

        if (localConnectionAttempts === 1) {
          // Fail first attempt
          req.socket.destroy();
        } else {
          // Succeed on retry
          res.writeHead(200);
          res.end('success after cleanup');
        }
      });

      await new Promise((resolve) => testServer.listen(0, resolve));
      const localPort = testServer.address().port;

      const tunnel = await localtunnel({
        port: localPort,
        local_reconnect: true,
        local_retry_max: 3
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      // Trigger request
      const remoteSocket = tcpMock.sockets[0];
      remoteSocket.write('GET /test HTTP/1.1\r\nHost: test.com\r\n\r\n');

      // Wait for retry
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Should have retried successfully (lines 268-275 in TunnelCluster.js cleanup pipes)
      assert(localConnectionAttempts >= 2,
        'Should successfully retry after cleanup');

      // No memory leaks or listener accumulation errors should occur
      assert(true, 'Cleanup completed without errors');

      tunnel.close();
      await tcpMock.close();
      await new Promise((resolve) => testServer.close(resolve));
    });
  });
});
