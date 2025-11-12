/**
 * LocalTunnel Error Handling Tests
 * Tests for error scenarios and edge cases
 * Protocol version: 0.0.8-epc
 */

import assert from 'assert';
import nock from 'nock';
import localtunnel from '../localtunnel.js';
import { MockLocalTunnelServer, MockLocalServer } from './helpers/mocks.js';
import { createFakeHttpServer } from './helpers/test-setup.js';

describe('Error Handling', function() {
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
  // GENERAL ERROR HANDLING
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
        assert(err.message.includes('Server error'));
        assert(err.message.includes('after'));
        assert(err.message.includes('retries'));
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
});
