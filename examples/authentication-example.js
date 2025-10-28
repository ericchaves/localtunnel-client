#!/usr/bin/env node

/**
 * LocalTunnel Client - Authentication Examples
 *
 * This file demonstrates how to use the new authentication features:
 * - Client Token Authentication (Protocol 0.0.9-epc)
 * - HMAC-SHA256 Authentication (Protocol 0.0.10-epc)
 * - Combined Authentication
 */

import localtunnel from '../localtunnel.js';
import http from 'http';

// Create a simple HTTP server for testing
const PORT = 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Hello from LocalTunnel!\nYou requested: ${req.url}\n`);
});

server.listen(PORT, async () => {
  console.log(`Local server listening on port ${PORT}`);
  console.log('Starting LocalTunnel examples...\n');

  // Example 1: Basic tunnel without authentication (backward compatible)
  console.log('='.repeat(60));
  console.log('Example 1: Basic Tunnel (No Authentication)');
  console.log('='.repeat(60));
  try {
    const tunnel1 = await localtunnel({
      port: PORT,
      subdomain: 'example-basic'
    });
    console.log('✓ Tunnel URL:', tunnel1.url);
    console.log('✓ Tunnel ID:', tunnel1.clientId);
    console.log('✓ Uses IP-based identification');
    tunnel1.close();
    console.log('✓ Tunnel closed\n');
  } catch (err) {
    console.error('✗ Error:', err.message, '\n');
  }

  // Example 2: Client Token authentication
  console.log('='.repeat(60));
  console.log('Example 2: Client Token Authentication');
  console.log('='.repeat(60));
  try {
    const clientToken = 'my-persistent-token-123';
    const tunnel2 = await localtunnel({
      port: PORT,
      subdomain: 'example-token',
      clientToken: clientToken
    });
    console.log('✓ Tunnel URL:', tunnel2.url);
    console.log('✓ Tunnel ID:', tunnel2.clientId);
    console.log('✓ Client Token:', clientToken);
    console.log('✓ Benefits:');
    console.log('  - Reconnect from different IPs with same subdomain');
    console.log('  - Persistent client identification');
    console.log('  - Priority over IP-based identification');
    tunnel2.close();
    console.log('✓ Tunnel closed\n');
  } catch (err) {
    console.error('✗ Error:', err.message, '\n');
  }

  // Example 3: HMAC-SHA256 authentication
  console.log('='.repeat(60));
  console.log('Example 3: HMAC-SHA256 Authentication');
  console.log('='.repeat(60));
  try {
    const hmacSecret = 'my-very-secure-shared-secret-at-least-32-characters-long';
    const tunnel3 = await localtunnel({
      port: PORT,
      subdomain: 'example-hmac',
      hmacSecret: hmacSecret
    });
    console.log('✓ Tunnel URL:', tunnel3.url);
    console.log('✓ Tunnel ID:', tunnel3.clientId);
    console.log('✓ HMAC Secret:', hmacSecret.substring(0, 10) + '...');
    console.log('✓ Benefits:');
    console.log('  - Cryptographic authentication of requests');
    console.log('  - Protection against replay attacks');
    console.log('  - Server validates request authenticity');
    console.log('✓ Headers sent:');
    console.log('  - Authorization: HMAC sha256=<signature>');
    console.log('  - X-Timestamp: <unix_seconds>');
    console.log('  - X-Nonce: <unix_milliseconds>');
    tunnel3.close();
    console.log('✓ Tunnel closed\n');
  } catch (err) {
    console.error('✗ Error:', err.message, '\n');
  }

  // Example 4: Combined authentication (Client Token + HMAC)
  console.log('='.repeat(60));
  console.log('Example 4: Combined Authentication (Token + HMAC)');
  console.log('='.repeat(60));
  try {
    const clientToken = 'my-token-456';
    const hmacSecret = 'another-very-secure-shared-secret-32-chars-minimum!!';
    const tunnel4 = await localtunnel({
      port: PORT,
      subdomain: 'example-combined',
      clientToken: clientToken,
      hmacSecret: hmacSecret
    });
    console.log('✓ Tunnel URL:', tunnel4.url);
    console.log('✓ Tunnel ID:', tunnel4.clientId);
    console.log('✓ Client Token:', clientToken);
    console.log('✓ HMAC Secret:', hmacSecret.substring(0, 10) + '...');
    console.log('✓ Benefits:');
    console.log('  - All benefits of Client Token authentication');
    console.log('  - All benefits of HMAC authentication');
    console.log('  - Maximum security');
    tunnel4.close();
    console.log('✓ Tunnel closed\n');
  } catch (err) {
    console.error('✗ Error:', err.message, '\n');
  }

  // Example 5: Invalid token (demonstration of validation)
  console.log('='.repeat(60));
  console.log('Example 5: Invalid Token (Validation Demo)');
  console.log('='.repeat(60));
  try {
    await localtunnel({
      port: PORT,
      clientToken: 'invalid@token!' // Contains invalid characters
    });
    console.log('✗ Should have failed validation');
  } catch (err) {
    console.log('✓ Validation correctly rejected invalid token');
    console.log('✓ Error:', err.message, '\n');
  }

  // Example 6: Short HMAC secret (demonstration of validation)
  console.log('='.repeat(60));
  console.log('Example 6: Short HMAC Secret (Validation Demo)');
  console.log('='.repeat(60));
  try {
    await localtunnel({
      port: PORT,
      hmacSecret: 'too-short' // Less than 32 characters
    });
    console.log('✗ Should have failed validation');
  } catch (err) {
    console.log('✓ Validation correctly rejected short secret');
    console.log('✓ Error:', err.message, '\n');
  }

  // Example 7: Using environment variables (recommended)
  console.log('='.repeat(60));
  console.log('Example 7: Using Environment Variables (Recommended)');
  console.log('='.repeat(60));
  console.log('Recommended usage:');
  console.log('');
  console.log('  export LT_CLIENT_TOKEN="your-secure-token"');
  console.log('  export LT_HMAC_SECRET="your-32-char-minimum-secret"');
  console.log('');
  console.log('  const tunnel = await localtunnel({');
  console.log('    port: 3000,');
  console.log('    subdomain: "myapp",');
  console.log('    clientToken: process.env.LT_CLIENT_TOKEN,');
  console.log('    hmacSecret: process.env.LT_HMAC_SECRET');
  console.log('  });');
  console.log('');

  // Example 8: CLI usage examples
  console.log('='.repeat(60));
  console.log('Example 8: CLI Usage');
  console.log('='.repeat(60));
  console.log('Basic usage:');
  console.log('  lt --port 3000 --subdomain myapp');
  console.log('');
  console.log('With Client Token:');
  console.log('  lt --port 3000 --subdomain myapp --client-token my-token-123');
  console.log('');
  console.log('With HMAC:');
  console.log('  lt --port 3000 --subdomain myapp \\');
  console.log('     --hmac-secret "my-very-secure-secret-32-characters"');
  console.log('');
  console.log('With both:');
  console.log('  lt --port 3000 --subdomain myapp \\');
  console.log('     --client-token my-token-123 \\');
  console.log('     --hmac-secret "my-very-secure-secret-32-characters"');
  console.log('');
  console.log('Using environment variables:');
  console.log('  export LT_CLIENT_TOKEN="my-token-123"');
  console.log('  export LT_HMAC_SECRET="my-very-secure-secret-32-characters"');
  console.log('  lt --port 3000 --subdomain myapp');
  console.log('');

  console.log('='.repeat(60));
  console.log('Examples completed!');
  console.log('='.repeat(60));

  server.close();
  process.exit(0);
});
