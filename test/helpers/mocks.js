/**
 * Mock utilities for LocalTunnel testing
 * Extracted from client.spec.reference.js v1.0.0
 * Protocol version: 0.0.8-epc
 */

import nock from 'nock';
import net from 'net';
import http from 'http';
import { EventEmitter } from 'events';

// =============================================================================
// PROTOCOL SPECIFICATIONS
// =============================================================================

export const PROTOCOL_SPECS = {
  // Tunnel creation endpoint
  TUNNEL_CREATION_METHOD: 'GET',
  TUNNEL_CREATION_PATH_RANDOM: '/?new',
  TUNNEL_CREATION_PATH_CUSTOM: '/:subdomain',

  // Response format (JSON)
  RESPONSE_FIELDS: ['id', 'port', 'max_conn_count', 'url'],

  // Subdomain validation
  SUBDOMAIN_MIN_LENGTH: 4,
  SUBDOMAIN_MAX_LENGTH: 63,
  SUBDOMAIN_PATTERN: /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/,

  // Connection parameters
  DEFAULT_MAX_SOCKETS: 10,
  DEFAULT_GRACE_PERIOD: 30000, // ms
  DEFAULT_REQUEST_TIMEOUT: 5000, // ms
  DEFAULT_WEBSOCKET_TIMEOUT: 10000, // ms

  // HTTP status codes
  STATUS_OK: 200,
  STATUS_FOUND: 302,
  STATUS_FORBIDDEN: 403,
  STATUS_NOT_FOUND: 404,
  STATUS_CONFLICT: 409,
  STATUS_SERVICE_UNAVAILABLE: 503,

  // Required client capabilities
  CAPABILITIES: [
    'tunnel_creation',
    'tcp_socket_management',
    'http_forwarding',
    'websocket_upgrade',
    'error_handling',
    'grace_period_reconnection'
  ]
};

// =============================================================================
// MOCK SERVER
// =============================================================================

/**
 * Mock LocalTunnel server for testing
 */
export class MockLocalTunnelServer {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'https://localtunnel.me';
    this.domain = options.domain || 'localtunnel.me';
    this.port = options.port || 443;
    this.tcpServers = new Map();
    this.tunnels = new Map();
  }

  /**
   * Mock tunnel creation endpoint
   */
  mockTunnelCreation(subdomain = null, options = {}) {
    const tunnelId = subdomain || this._generateRandomId();
    const tcpPort = options.port || this._getRandomPort();
    const maxConnCount = options.maxConnCount || 10;

    const path = subdomain ? `/${subdomain}` : '/';
    const scope = nock(this.baseUrl)
      .get(path)
      .query(subdomain ? {} : { new: '' })
      .reply(options.statusCode || 200, {
        id: tunnelId,
        ip: '127.0.0.1', // Return localhost so TCP connection works
        port: tcpPort,
        max_conn_count: maxConnCount,
        url: `https://${tunnelId}.${this.domain}`
      });

    this.tunnels.set(tunnelId, {
      id: tunnelId,
      port: tcpPort,
      maxConnCount: maxConnCount,
      sockets: []
    });

    return { tunnelId, tcpPort, maxConnCount, scope };
  }

  /**
   * Mock tunnel creation with error
   */
  mockTunnelCreationError(subdomain, statusCode, errorMessage, times = 1) {
    const path = subdomain ? `/${subdomain}` : '/';
    return nock(this.baseUrl)
      .get(path)
      .query(subdomain ? {} : { new: '' })
      .times(times)
      .reply(statusCode, { message: errorMessage });
  }

  /**
   * Mock tunnel creation with 409 (Conflict - subdomain reserved)
   */
  mockSubdomainReserved(subdomain, remainingTime = 25) {
    return this.mockTunnelCreationError(
      subdomain,
      409,
      `Subdomain "${subdomain}" is reserved by another client. Try again in ${remainingTime}s or use a different subdomain.`
    );
  }

  /**
   * Mock tunnel creation with 403 (Invalid subdomain format)
   */
  mockInvalidSubdomain(subdomain) {
    return this.mockTunnelCreationError(
      subdomain,
      403,
      'Invalid subdomain format. Must be 4-63 alphanumeric characters (hyphens allowed in middle).'
    );
  }

  /**
   * Create a mock TCP server for client connections
   * Returns a promise that resolves when server is listening
   */
  createMockTcpServer(port, options = {}) {
    return new Promise((resolve) => {
      const server = net.createServer();
      const emitter = new EventEmitter();
      const sockets = [];

      server.on('connection', (socket) => {
        sockets.push(socket);
        emitter.emit('clientConnected', socket);

        socket.on('data', (data) => {
          emitter.emit('clientData', socket, data);
        });

        socket.on('close', () => {
          const index = sockets.indexOf(socket);
          if (index > -1) sockets.splice(index, 1);
          emitter.emit('clientDisconnected', socket);
        });
      });

      server.listen(port, () => {
        emitter.emit('serverReady', port);

        const mockServer = {
          server,
          emitter,
          sockets,
          close: () => {
            return new Promise((resolveClose) => {
              sockets.forEach(s => s.destroy());
              server.close(() => {
                this.tcpServers.delete(port);
                resolveClose();
              });
            });
          }
        };

        this.tcpServers.set(port, mockServer);
        resolve(mockServer);
      });
    });
  }

  /**
   * Simulate server sending HTTP request to client socket
   */
  sendHttpRequest(socket, options = {}) {
    const method = options.method || 'GET';
    const path = options.path || '/';
    const headers = options.headers || { host: 'example.com' };
    const body = options.body || '';

    const headerLines = Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`);

    const request = [
      `${method} ${path} HTTP/1.1`,
      ...headerLines,
      '',
      body
    ].join('\r\n');

    socket.write(request);
  }

  /**
   * Simulate server sending WebSocket upgrade request
   */
  sendWebSocketUpgrade(socket, options = {}) {
    const path = options.path || '/';
    const headers = {
      'Host': 'example.com',
      'Upgrade': 'websocket',
      'Connection': 'Upgrade',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
      ...options.headers
    };

    this.sendHttpRequest(socket, {
      method: 'GET',
      path,
      headers
    });
  }

  /**
   * Helper to generate random subdomain
   */
  _generateRandomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Helper to get random port
   */
  _getRandomPort() {
    return 10000 + Math.floor(Math.random() * 1000);
  }

  /**
   * Cleanup all mocks
   */
  async cleanup() {
    nock.cleanAll();

    const closePromises = [];
    for (const [port, { server, sockets }] of this.tcpServers) {
      closePromises.push(new Promise((resolve) => {
        sockets.forEach(s => s.destroy());
        server.close(() => resolve());
      }));
    }

    await Promise.all(closePromises);
    this.tcpServers.clear();
    this.tunnels.clear();
  }
}

// =============================================================================
// MOCK LOCAL HTTP SERVER
// =============================================================================

/**
 * Mock local HTTP server that the client will forward requests to
 */
export class MockLocalServer {
  constructor(port = 3000) {
    this.port = port;
    this.server = null;
    this.requestHandler = null;
  }

  start(handler) {
    return new Promise((resolve) => {
      this.requestHandler = handler || ((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hello from local service');
      });

      this.server = http.createServer(this.requestHandler);
      this.server.listen(this.port, () => resolve());
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
