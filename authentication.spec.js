/**
 * LocalTunnel Client Authentication Tests
 * Protocol version: 0.0.10-epc
 *
 * Tests for:
 * - Client Token Authentication (Protocol 0.0.9-epc)
 * - HMAC Authentication (Protocol 0.0.10-epc)
 */

/* eslint-disable no-console */

import crypto from 'crypto';
import assert from 'assert';
import nock from 'nock';
import localtunnel from './localtunnel.js';
import { MockLocalTunnelServer, PROTOCOL_SPECS } from './test/helpers/mocks.js';

describe('LocalTunnel Client - Authentication', function() {
  let mockServer;
  let fakePort;

  // Tests use mocks, so we can use shorter timeout
  this.timeout(2000);

  before(() => {
    fakePort = 3000; // We don't need a real server for these tests
  });

  beforeEach(function() {
    mockServer = new MockLocalTunnelServer({
      baseUrl: 'https://localtunnel.me',
      domain: 'localtunnel.me'
    });
  });

  afterEach(async function() {
    await mockServer.cleanup();
  });

  // ===========================================================================
  // CLIENT TOKEN AUTHENTICATION TESTS (Protocol 0.0.9-epc)
  // ===========================================================================

  describe('Client Token Authentication (X-LT-Client-Token)', function() {
    it('should send client token header when configured', async () => {
      const clientToken = 'my-test-token-123';
      const subdomain = 'token-test';

      // Use nock directly to verify the header
      const scope = nock('https://localtunnel.me')
        .matchHeader('X-LT-Client-Token', clientToken)
        .get(`/${subdomain}`)
        .reply(200, {
          id: subdomain,
          ip: '127.0.0.1',
          port: 10000,
          max_conn_count: 10,
          url: `https://${subdomain}.localtunnel.me`
        });

      const tcpMock = await mockServer.createMockTcpServer(10000);

      const tunnel = await localtunnel({
        port: fakePort,
        subdomain: subdomain,
        clientToken: clientToken
      });

      assert(scope.isDone(), 'Client token header should be sent');

      tunnel.close();
      await tcpMock.close();
    });

    it('should work without token (backward compatibility)', async () => {
      const subdomain = 'no-token';
      const { tunnelId, tcpPort } = mockServer.mockTunnelCreation(subdomain);
      const tcpMock = await mockServer.createMockTcpServer(tcpPort);

      const tunnel = await localtunnel({
        port: fakePort,
        subdomain: subdomain
        // No clientToken specified
      });

      assert.equal(tunnel.clientId, subdomain);

      tunnel.close();
      await tcpMock.close();
    });

    it('should validate token format locally before sending', async () => {
      const invalidTokens = [
        { token: 'token with spaces', desc: 'spaces' },
        { token: 'token@invalid', desc: 'invalid character @' },
        { token: 'token#special', desc: 'invalid character #' },
        { token: 'a'.repeat(300), desc: 'too long (>256)' },
      ];

      for (const { token, desc } of invalidTokens) {
        try {
          await localtunnel({
            port: fakePort,
            clientToken: token
          });
          assert.fail(`Should reject invalid token with ${desc}`);
        } catch (err) {
          assert.match(err.message, /clientToken/i, `Should mention clientToken in error for ${desc}`);
        }
      }
    });

    it('should allow valid token characters (alphanumeric, hyphens, underscores)', async () => {
      const validToken = 'Valid-Token_123';
      const subdomain = 'valid-token';

      const scope = nock('https://localtunnel.me')
        .matchHeader('X-LT-Client-Token', validToken)
        .get(`/${subdomain}`)
        .reply(200, {
          id: subdomain,
          ip: '127.0.0.1',
          port: 10001,
          max_conn_count: 10,
          url: `https://${subdomain}.localtunnel.me`
        });

      const tcpMock = await mockServer.createMockTcpServer(10001);

      const tunnel = await localtunnel({
        port: fakePort,
        subdomain: subdomain,
        clientToken: validToken
      });

      assert.equal(tunnel.clientId, subdomain);
      assert(scope.isDone());

      tunnel.close();
      await tcpMock.close();
    });

    it('should reject non-string token', async () => {
      try {
        await localtunnel({
          port: fakePort,
          clientToken: 12345 // Number instead of string
        });
        assert.fail('Should reject non-string token');
      } catch (err) {
        assert.match(err.message, /string/i);
      }
    });
  });

  // ===========================================================================
  // HMAC AUTHENTICATION TESTS (Protocol 0.0.10-epc)
  // ===========================================================================

  describe('HMAC Authentication (Optional)', function() {
    it('should send HMAC authentication headers when configured', async () => {
      const hmacSecret = 'my-shared-secret-at-least-32-chars-long!!';
      const subdomain = 'hmac-test';

      // Verify all three HMAC headers are present
      const scope = nock('https://localtunnel.me')
        .matchHeader('Authorization', /^HMAC sha256=[a-f0-9]{64}$/)
        .matchHeader('X-Timestamp', /^\d+$/)
        .matchHeader('X-Nonce', /^\d+$/)
        .get(`/${subdomain}`)
        .reply(200, {
          id: subdomain,
          ip: '127.0.0.1',
          port: 10002,
          max_conn_count: 10,
          url: `https://${subdomain}.localtunnel.me`
        });

      const tcpMock = await mockServer.createMockTcpServer(10002);

      const tunnel = await localtunnel({
        port: fakePort,
        subdomain: subdomain,
        hmacSecret: hmacSecret
      });

      assert(scope.isDone(), 'All HMAC headers should be sent');

      tunnel.close();
      await tcpMock.close();
    });

    it('should calculate HMAC signature correctly', async () => {
      // We can't easily test the exact signature without mocking Date.now(),
      // but we can verify the format and that it's a valid hex string
      const hmacSecret = 'test-secret-32-characters-long!!';
      const subdomain = 'test-subdomain';

      let capturedHeaders = null;
      const scope = nock('https://localtunnel.me')
        .get(`/${subdomain}`)
        .reply(function() {
          capturedHeaders = this.req.headers;
          return [200, {
            id: subdomain,
            ip: '127.0.0.1',
            port: 10003,
            max_conn_count: 10,
            url: `https://${subdomain}.localtunnel.me`
          }];
        });

      const tcpMock = await mockServer.createMockTcpServer(10003);

      const tunnel = await localtunnel({
        port: fakePort,
        subdomain: subdomain,
        hmacSecret: hmacSecret
      });

      assert(capturedHeaders, 'Should have captured headers');
      assert(capturedHeaders.authorization, 'Should have Authorization header');
      assert(capturedHeaders['x-timestamp'], 'Should have X-Timestamp header');
      assert(capturedHeaders['x-nonce'], 'Should have X-Nonce header');

      // Verify Authorization format
      const authMatch = capturedHeaders.authorization.match(/^HMAC sha256=([a-f0-9]{64})$/);
      assert(authMatch, 'Authorization should match HMAC format');

      // Verify timestamp is Unix seconds (10 digits)
      const timestamp = parseInt(capturedHeaders['x-timestamp'], 10);
      assert(!isNaN(timestamp), 'Timestamp should be a number');
      assert(timestamp > 1700000000, 'Timestamp should be recent (after 2023)');

      // Verify nonce is Unix milliseconds (13 digits)
      const nonce = parseInt(capturedHeaders['x-nonce'], 10);
      assert(!isNaN(nonce), 'Nonce should be a number');
      assert(nonce.toString().length >= 13, 'Nonce should be milliseconds (13+ digits)');

      // Verify we can recalculate the signature
      const method = 'GET';
      const path = `/${subdomain}`;
      const body = '';
      const message = `${method}${path}${timestamp}${nonce}${body}`;
      const expectedSignature = crypto
        .createHmac('sha256', hmacSecret)
        .update(message)
        .digest('hex');

      assert.equal(authMatch[1], expectedSignature, 'Signature should match expected value');

      tunnel.close();
      await tcpMock.close();
    });

    it('should use numeric nonce (Unix epoch in milliseconds)', async () => {
      const hmacSecret = 'secret-32-chars-long-secret-here!!';
      const subdomain = 'nonce-test';

      let capturedNonce = null;
      const scope = nock('https://localtunnel.me')
        .get(`/${subdomain}`)
        .reply(function() {
          capturedNonce = this.req.headers['x-nonce'];
          return [200, {
            id: subdomain,
            ip: '127.0.0.1',
            port: 10004,
            max_conn_count: 10,
            url: `https://${subdomain}.localtunnel.me`
          }];
        });

      const tcpMock = await mockServer.createMockTcpServer(10004);

      const tunnel = await localtunnel({
        port: fakePort,
        subdomain: subdomain,
        hmacSecret: hmacSecret
      });

      const nonce = parseInt(capturedNonce, 10);
      assert(!isNaN(nonce), 'Nonce should be numeric');
      assert(nonce > 0, 'Nonce should be positive');
      assert(nonce.toString().length >= 13, 'Nonce should have millisecond precision (13+ digits)');

      tunnel.close();
      await tcpMock.close();
    });

    it('should use current Unix timestamp in seconds', async () => {
      const hmacSecret = 'secret-32-chars-long-secret-here!!';
      const subdomain = 'timestamp-test';

      let capturedTimestamp = null;
      const scope = nock('https://localtunnel.me')
        .get(`/${subdomain}`)
        .reply(function() {
          capturedTimestamp = this.req.headers['x-timestamp'];
          return [200, {
            id: subdomain,
            ip: '127.0.0.1',
            port: 10005,
            max_conn_count: 10,
            url: `https://${subdomain}.localtunnel.me`
          }];
        });

      const tcpMock = await mockServer.createMockTcpServer(10005);

      const now = Math.floor(Date.now() / 1000);

      const tunnel = await localtunnel({
        port: fakePort,
        subdomain: subdomain,
        hmacSecret: hmacSecret
      });

      const timestamp = parseInt(capturedTimestamp, 10);
      const diff = Math.abs(timestamp - now);
      assert(diff < 5, 'Timestamp should be within 5 seconds of current time');

      tunnel.close();
      await tcpMock.close();
    });

    it('should not send HMAC headers when server does not require it', async () => {
      const subdomain = 'no-hmac';

      let capturedHeaders = null;
      const scope = nock('https://localtunnel.me')
        .get(`/${subdomain}`)
        .reply(function() {
          capturedHeaders = this.req.headers;
          return [200, {
            id: subdomain,
            ip: '127.0.0.1',
            port: 10006,
            max_conn_count: 10,
            url: `https://${subdomain}.localtunnel.me`
          }];
        });

      const tcpMock = await mockServer.createMockTcpServer(10006);

      const tunnel = await localtunnel({
        port: fakePort,
        subdomain: subdomain
        // No hmacSecret provided
      });

      // Verify HMAC headers are NOT present
      assert.equal(capturedHeaders.authorization, undefined, 'Should not have Authorization header');
      assert.equal(capturedHeaders['x-timestamp'], undefined, 'Should not have X-Timestamp header');
      assert.equal(capturedHeaders['x-nonce'], undefined, 'Should not have X-Nonce header');

      tunnel.close();
      await tcpMock.close();
    });

    it('should validate HMAC secret length (min 32 characters)', async () => {
      const shortSecret = 'too-short'; // Less than 32 chars

      try {
        await localtunnel({
          port: fakePort,
          hmacSecret: shortSecret
        });
        assert.fail('Should reject short HMAC secret');
      } catch (err) {
        assert.match(err.message, /32/);
        assert.match(err.message, /characters/i);
      }
    });

    it('should reject non-string HMAC secret', async () => {
      try {
        await localtunnel({
          port: fakePort,
          hmacSecret: 123456789012345678901234567890123 // Number instead of string
        });
        assert.fail('Should reject non-string HMAC secret');
      } catch (err) {
        assert.match(err.message, /string/i);
      }
    });
  });

  // ===========================================================================
  // COMBINED AUTHENTICATION TESTS
  // ===========================================================================

  describe('Combined Client Token and HMAC Authentication', function() {
    it('should send both Client Token and HMAC headers when both are configured', async () => {
      const clientToken = 'my-token-123';
      const hmacSecret = 'my-shared-secret-at-least-32-chars-long!!';
      const subdomain = 'combined-auth';

      const scope = nock('https://localtunnel.me')
        .matchHeader('X-LT-Client-Token', clientToken)
        .matchHeader('Authorization', /^HMAC sha256=[a-f0-9]{64}$/)
        .matchHeader('X-Timestamp', /^\d+$/)
        .matchHeader('X-Nonce', /^\d+$/)
        .get(`/${subdomain}`)
        .reply(200, {
          id: subdomain,
          ip: '127.0.0.1',
          port: 10007,
          max_conn_count: 10,
          url: `https://${subdomain}.localtunnel.me`
        });

      const tcpMock = await mockServer.createMockTcpServer(10007);

      const tunnel = await localtunnel({
        port: fakePort,
        subdomain: subdomain,
        clientToken: clientToken,
        hmacSecret: hmacSecret
      });

      assert(scope.isDone(), 'Both Client Token and HMAC headers should be sent');

      tunnel.close();
      await tcpMock.close();
    });
  });
});
