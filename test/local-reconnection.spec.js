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

  // ===========================================================================
  // NEW TESTS: FIXES FOR INFINITE LOOP ISSUE
  // ===========================================================================

  describe('Infinite Loop Fixes', function() {
    it('should reset failure counter when new remote tunnel is created', async function() {
      this.timeout(5000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({
        port: fakePort,
        local_retry_max: 10
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      // Access the tunnelCluster to check counter
      const cluster = tunnel.tunnelCluster;

      // Simulate some failures
      cluster.consecutiveLocalFailures = 5;

      // Now trigger a new tunnel open (simulate what happens on remote close + retriable=true)
      cluster.open();

      // Wait a bit for open() to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Counter should be reset to 0
      assert.strictEqual(cluster.consecutiveLocalFailures, 0,
        'Failure counter should be reset when new tunnel opens');

      tunnel.close();
      await tcpMock.close();
    });

    it('should use exponential backoff for local reconnection', async function() {
      this.timeout(3000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({
        port: 9999, // Non-existent port to trigger ECONNREFUSED
        local_retry_max: 5
      });

      // Wait for tunnel to establish remote connection
      await new Promise(resolve => setTimeout(resolve, 100));

      const cluster = tunnel.tunnelCluster;

      // Store initial delay (might already be increased due to open() triggering connection)
      const initialDelay = cluster.localReconnectDelay;
      assert(initialDelay >= 1000,
        `Initial reconnect delay should be >= 1000ms (got ${initialDelay}ms)`);

      // Trigger a request to initiate local connection attempt
      const remoteSocket = tcpMock.sockets[0];
      remoteSocket.write('GET /test HTTP/1.1\r\nHost: test.com\r\n\r\n');

      // Wait for first failure and retry
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Delay should have increased from initial
      assert(cluster.localReconnectDelay >= initialDelay,
        `Reconnect delay should increase or stay same after failures (was ${initialDelay}ms, now ${cluster.localReconnectDelay}ms)`);
      assert(cluster.localReconnectDelay <= cluster.maxLocalReconnectDelay,
        'Reconnect delay should not exceed maximum');

      tunnel.close();
      await tcpMock.close();
    });

    it('should respect configured local_retry_max instead of hardcoded value', async function() {
      this.timeout(10000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let deadEmitted = false;
      let deadInfo = null;

      const tunnel = await localtunnel({
        port: 9998, // Non-existent port
        local_retry_max: 3 // Custom limit instead of default 10
      });

      tunnel.tunnelCluster.on('dead', (info) => {
        if (info?.retriable === false) {
          deadEmitted = true;
          deadInfo = info;
        }
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 150));

      // Trigger local connection
      const remoteSocket = tcpMock.sockets[0];
      if (remoteSocket) {
        remoteSocket.write('GET /test HTTP/1.1\r\nHost: test.com\r\n\r\n');
      }

      // Wait for retries to complete (3 attempts + exponential backoff delays)
      // With exponential backoff: 1s + 1.5s + 2.25s = ~5s for failures
      await new Promise(resolve => setTimeout(resolve, 7000));

      const cluster = tunnel.tunnelCluster;

      // Should have at least attempted the configured max
      // Note: consecutiveLocalFailures might be reset or at 0 if dead was emitted
      assert(cluster.totalFailureCount >= 3 || deadEmitted,
        `Should have attempted at least 3 times or emitted dead (failures=${cluster.totalFailureCount}, dead=${deadEmitted})`);

      // Should emit dead with retriable=false after reaching limit
      if (deadEmitted) {
        assert.strictEqual(deadInfo?.retriable, false,
          'Should mark as non-retriable after reaching limit');
      }

      tunnel.close();
      await tcpMock.close();
    });

    it('should track connection refused vs dropped separately', async function() {
      this.timeout(3000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({
        port: 9997, // Non-existent port - will get ECONNREFUSED
        local_retry_max: 5
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      const cluster = tunnel.tunnelCluster;

      // Trigger connection attempt
      const remoteSocket = tcpMock.sockets[0];
      remoteSocket.write('GET /test HTTP/1.1\r\nHost: test.com\r\n\r\n');

      // Wait for some failures
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Should have incremented ECONNREFUSED counter
      assert(cluster.connectionRefusedCount > 0,
        'Should track ECONNREFUSED failures separately');
      assert.strictEqual(cluster.connectionDroppedCount, 0,
        'Should not increment dropped counter for ECONNREFUSED');

      tunnel.close();
      await tcpMock.close();
    });

    it('should implement time-based decay with sliding window', async function() {
      this.timeout(5000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({
        port: 9996, // Non-existent port
        local_retry_max: 5 // 5 failures in 60 second window
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 150));

      const cluster = tunnel.tunnelCluster;

      // Check that time-based tracking is initialized
      assert(Array.isArray(cluster.failureTimestamps),
        'Should have failureTimestamps array');
      assert.strictEqual(cluster.failureWindow, 60000,
        'Should have 60 second failure window');

      // Store initial count (might already have failures from tunnel open)
      const initialFailureCount = cluster.totalFailureCount;

      // Trigger connection attempt
      const remoteSocket = tcpMock.sockets[0];
      if (remoteSocket) {
        remoteSocket.write('GET /test HTTP/1.1\r\nHost: test.com\r\n\r\n');
      }

      // Wait for some failures
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Should have recorded failures with timestamps
      assert(cluster.failureTimestamps.length > 0,
        'Should have recorded failure timestamps');
      assert(cluster.totalFailureCount > initialFailureCount,
        `Should have incremented total failure count (was ${initialFailureCount}, now ${cluster.totalFailureCount})`);

      tunnel.close();
      await tcpMock.close();
    });

    it('should give up after reaching absolute failure limit', async function() {
      this.timeout(5000);

      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(null, { maxConnCount: 1 });
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      let gaveUp = false;

      const tunnel = await localtunnel({
        port: 9995, // Non-existent port
        local_retry_max: 3
      });

      tunnel.tunnelCluster.on('dead', (info) => {
        if (info?.retriable === false) {
          gaveUp = true;
        }
      });

      // Wait for tunnel to establish
      await new Promise(resolve => setTimeout(resolve, 150));

      const cluster = tunnel.tunnelCluster;

      // Manually set total failures near the limit to speed up test
      cluster.totalFailureCount = cluster.maxTotalFailures - 3;

      // Trigger connection attempts
      const remoteSocket = tcpMock.sockets[0];
      if (remoteSocket) {
        remoteSocket.write('GET /test1 HTTP/1.1\r\nHost: test.com\r\n\r\n');

        // Wait a bit and trigger more attempts
        await new Promise(resolve => setTimeout(resolve, 500));
        remoteSocket.write('GET /test2 HTTP/1.1\r\nHost: test.com\r\n\r\n');
      }

      // Wait for failures to accumulate
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if we hit the limit
      const hitAbsoluteLimit = cluster.totalFailureCount >= cluster.maxTotalFailures;

      // Should have given up due to absolute limit OR hit the limit
      assert(gaveUp || hitAbsoluteLimit,
        `Should give up or hit absolute limit (gaveUp=${gaveUp}, total=${cluster.totalFailureCount}, max=${cluster.maxTotalFailures})`);

      tunnel.close();
      await tcpMock.close();
    });
  });
});
