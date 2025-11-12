/**
 * LocalTunnel Client Lifecycle Tests
 * Tests for client API and lifecycle management
 * Protocol version: 0.0.8-epc
 */

import http from 'http';
import assert from 'assert';
import localtunnel from '../localtunnel.js';
import { MockLocalTunnelServer, MockLocalServer } from './helpers/mocks.js';
import { closeServer, createFakeHttpServer } from './helpers/test-setup.js';

describe('Client Lifecycle', function() {
  let mockServer;
  let localServer;
  let fakePort;

  this.timeout(2000);

  before(async () => {
    const { port } = await createFakeHttpServer();
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
