/**
 * LocalTunnel Tunnel Creation Tests
 * Tests for core tunnel initialization and configuration
 * Protocol version: 0.0.8-epc
 */

import http from 'http';
import assert from 'assert';
import localtunnel from '../localtunnel.js';
import { MockLocalTunnelServer, MockLocalServer } from './helpers/mocks.js';
import { closeServer, createFakeHttpServer } from './helpers/test-setup.js';

describe('Tunnel Creation', function() {
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
  // BASIC TUNNEL CREATION
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
  // ERROR HANDLING
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
  // CONFIGURATION
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
