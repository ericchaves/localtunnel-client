#!/usr/bin/env node

/**
 * LocalTunnel Client - .env File Usage Example
 *
 * This example demonstrates how to use environment variables from a .env file
 * to configure the LocalTunnel client.
 *
 * Setup:
 * 1. Copy .env.example to .env:
 *    cp .env.example .env
 *
 * 2. Edit .env with your settings
 *
 * 3. Run this example:
 *    node examples/dotenv-usage.js
 *
 * Note: The yargs library (used by the CLI) automatically reads environment
 * variables with the LT_ prefix, so you can also just run:
 *    lt
 *
 * And it will automatically use the variables from your shell environment.
 */

import { config } from 'dotenv';
import localtunnel from '../localtunnel.js';
import http from 'http';

// Load environment variables from .env file
// Note: This is optional - the CLI does this automatically
const result = config();

if (result.error) {
  console.log('⚠️  No .env file found. Using default settings or system environment variables.');
  console.log('   To use a .env file: cp .env.example .env\n');
} else {
  console.log('✓ Loaded environment variables from .env file\n');
}

// Read configuration from environment variables
const port = parseInt(process.env.LT_PORT || '3000', 10);
const subdomain = process.env.LT_SUBDOMAIN;
const host = process.env.LT_HOST;
const clientToken = process.env.LT_CLIENT_TOKEN;
const hmacSecret = process.env.LT_HMAC_SECRET;

console.log('Configuration from environment:');
console.log('━'.repeat(60));
console.log(`Port:         ${port}`);
console.log(`Host:         ${host || 'https://localtunnel.me (default)'}`);
console.log(`Subdomain:    ${subdomain || 'random (default)'}`);
console.log(`Client Token: ${clientToken ? '✓ Configured' : '✗ Not set (optional)'}`);
console.log(`HMAC Secret:  ${hmacSecret ? '✓ Configured' : '✗ Not set (optional)'}`);
console.log('━'.repeat(60));
console.log();

// Create a simple test server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>LocalTunnel Test</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
          }
          .card {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          h1 { color: #333; }
          .status {
            background: #e8f5e9;
            color: #2e7d32;
            padding: 10px 15px;
            border-radius: 4px;
            margin: 15px 0;
          }
          .info {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 14px;
          }
          .label {
            color: #666;
            font-weight: bold;
            display: inline-block;
            width: 150px;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>✓ LocalTunnel is Working!</h1>
          <div class="status">
            Successfully connected via LocalTunnel
          </div>
          <div class="info">
            <div><span class="label">Local Port:</span> ${port}</div>
            <div><span class="label">Subdomain:</span> ${subdomain || 'random'}</div>
            <div><span class="label">Authentication:</span> ${clientToken || hmacSecret ? 'Enabled' : 'Disabled'}</div>
            ${clientToken ? '<div><span class="label">Client Token:</span> ✓ Configured</div>' : ''}
            ${hmacSecret ? '<div><span class="label">HMAC Auth:</span> ✓ Configured</div>' : ''}
          </div>
          <p style="margin-top: 20px; color: #666;">
            This page is served from your local machine at localhost:${port}
          </p>
        </div>
      </body>
    </html>
  `);
});

server.listen(port, async () => {
  console.log(`✓ Local HTTP server listening on port ${port}`);
  console.log();

  try {
    // Build tunnel options from environment variables
    const options = { port };

    if (subdomain) options.subdomain = subdomain;
    if (host) options.host = host;
    if (clientToken) options.clientToken = clientToken;
    if (hmacSecret) options.hmacSecret = hmacSecret;

    console.log('Connecting to LocalTunnel server...');
    const tunnel = await localtunnel(options);

    console.log();
    console.log('🎉 Tunnel established successfully!');
    console.log('━'.repeat(60));
    console.log(`Public URL:   ${tunnel.url}`);
    console.log(`Tunnel ID:    ${tunnel.clientId}`);
    console.log('━'.repeat(60));
    console.log();
    console.log('✓ Your local server is now accessible to the world!');
    console.log('✓ Press Ctrl+C to close the tunnel');
    console.log();

    if (clientToken) {
      console.log('🔑 Client Token authentication is active');
      console.log('   You can reconnect with the same subdomain from different IPs');
      console.log();
    }

    if (hmacSecret) {
      console.log('🔒 HMAC authentication is active');
      console.log('   Your requests are cryptographically signed');
      console.log();
    }

    // Handle errors
    tunnel.on('error', (err) => {
      console.error('❌ Tunnel error:', err.message);
    });

    // Handle close
    tunnel.on('close', () => {
      console.log('Tunnel closed');
      server.close();
      process.exit(0);
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log('\n\nClosing tunnel...');
      tunnel.close();
    });

  } catch (err) {
    console.error('\n❌ Error creating tunnel:', err.message);
    console.error();

    if (err.message.includes('clientToken')) {
      console.error('💡 Check your LT_CLIENT_TOKEN in .env file');
      console.error('   Format: alphanumeric, hyphens, underscores only (max 256 chars)');
    }

    if (err.message.includes('hmacSecret')) {
      console.error('💡 Check your LT_HMAC_SECRET in .env file');
      console.error('   Minimum 32 characters required');
    }

    server.close();
    process.exit(1);
  }
});

server.on('error', (err) => {
  console.error(`\n❌ Server error: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error(`   Port ${port} is already in use`);
    console.error(`   Change LT_PORT in your .env file to a different port`);
  }
  process.exit(1);
});
