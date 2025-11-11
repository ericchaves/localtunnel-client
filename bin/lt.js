#!/usr/bin/env node
/* eslint-disable no-console */

import open from 'open';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';
import debugLib from 'debug';

// Load .env file into process.env for yargs .env('LT') to read
config();

// Re-enable debug with the value from .env (fixes timing issue with ES module hoisting)
if (process.env.DEBUG) {
  debugLib.enable(process.env.DEBUG);
}

import localtunnel from '../localtunnel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
const { version } = packageJson;

const { argv } = yargs(hideBin(process.argv))
  .usage('Usage: lt --port [num] <options>')
  .env('LT')
  .option('p', {
    alias: 'port',
    describe: 'Internal HTTP server port',
  })
  .option('h', {
    alias: 'host',
    describe: 'Upstream server providing forwarding',
    default: 'https://localtunnel.me',
  })
  .option('s', {
    alias: 'subdomain',
    describe: 'Request this subdomain',
  })
  .option('l', {
    alias: 'local-host',
    describe: 'Tunnel traffic to this host instead of localhost, override Host header to this host',
  })
  .option('local-https', {
    describe: 'Tunnel traffic to a local HTTPS server',
  })
  .option('local-cert', {
    describe: 'Path to certificate PEM file for local HTTPS server',
  })
  .option('local-key', {
    describe: 'Path to certificate key file for local HTTPS server',
  })
  .option('local-ca', {
    describe: 'Path to certificate authority file for self-signed certificates',
  })
  .option('allow-invalid-cert', {
    describe: 'Disable certificate checks for your local HTTPS server (ignore cert/key/ca options)',
  })
  .option('client-token', {
    describe: 'Client token for authentication and subdomain reservation (Protocol 0.0.9-epc)\n' +
              'Environment variable: LT_CLIENT_TOKEN',
  })
  .option('hmac-secret', {
    describe: 'HMAC secret for request authentication, min 32 characters (Protocol 0.0.10-epc)\n' +
              'Environment variable: LT_HMAC_SECRET',
  })
  .options('o', {
    alias: 'open',
    describe: 'Opens the tunnel URL in your browser',
  })
  .option('print-requests', {
    describe: 'Print basic request info',
  })
  .option('dump-dir', {
    describe: 'Directory to dump HTTP requests/responses as YAML files',
    type: 'string',
  })
  .option('local-reconnect', {
    describe: 'Enable automatic reconnection when local server connection fails',
    default: true,
  })
  .option('local-retry-max', {
    describe: 'Maximum retry attempts for local server reconnection (0 = infinite)',
    default: 0,
    type: 'number',
  })
  .require('port')
  .boolean('local-https')
  .boolean('allow-invalid-cert')
  .boolean('print-requests')
  .boolean('local-reconnect')
  .help('help', 'Show this help and exit')
  .version(`localtunnel client (${version} with epc modifications)`);

if (typeof argv.port !== 'number') {
  yargs.showHelp();
  console.error('\nInvalid argument: `port` must be a number');
  console.error(`Received: ${typeof argv.port} = ${argv.port}`);
  console.error('Example: lt --port 3000');
  process.exit(1);
}

(async () => {
  const tunnel = await localtunnel({
    port: argv.port,
    host: argv.host,
    subdomain: argv.subdomain,
    local_host: argv.localHost,
    local_https: argv.localHttps,
    local_cert: argv.localCert,
    local_key: argv.localKey,
    local_ca: argv.localCa,
    allow_invalid_cert: argv.allowInvalidCert,
    clientToken: argv.clientToken,
    hmacSecret: argv.hmacSecret,
    dump_dir: argv.dumpDir,
    local_reconnect: argv.localReconnect,
    local_retry_max: argv.localRetryMax,
  }).catch(err => {
    console.error('\n❌ Failed to establish tunnel:');
    console.error(`   ${err.message}`);

    if (err.message.includes('ECONNREFUSED')) {
      console.error('\n💡 Troubleshooting:');
      console.error('   - Check if the tunnel server is accessible');
      console.error('   - Verify your internet connection');
      console.error('   - Try a different --host if using custom server');
    } else if (err.message.includes('Too many connections')) {
      console.error('\n💡 The server has reached its connection limit');
      console.error('   - Wait a moment and try again');
      console.error('   - Or try a different server with --host');
    } else if (err.message.includes('HTTP 403')) {
      console.error('\n💡 Possible causes:');
      console.error('   - Invalid subdomain format');
      console.error('   - Subdomain restricted by server');
      console.error('   - Authentication required');
    } else if (err.message.includes('HTTP 409')) {
      console.error('\n💡 This subdomain is already in use');
      console.error('   - Try a different subdomain');
      console.error('   - Or use client token authentication');
    }
    process.exit(1);
  });

  tunnel.on('error', err => {
    console.error('\n❌ Tunnel error:');
    console.error(`   ${err.message}`);
    console.error('\n💡 The tunnel connection was lost. Please restart.');
    process.exit(1);
  });

  console.log('\n✓ Tunnel established successfully!');
  console.log('  Public URL:  %s', tunnel.url);
  console.log('  Tunnel ID:   %s', tunnel.clientId);

  /**
   * `cachedUrl` is set when using a proxy server that support resource caching.
   * This URL generally remains available after the tunnel itself has closed.
   * @see https://github.com/localtunnel/localtunnel/pull/319#discussion_r319846289
   */
  if (tunnel.cachedUrl) {
    console.log('  Cached URL:  %s', tunnel.cachedUrl);
  }

  if (argv.clientToken) {
    console.log('  Auth:        Client Token');
  }
  if (argv.hmacSecret) {
    console.log('  Security:    HMAC-SHA256');
  }

  console.log('\n  Press Ctrl+C to close the tunnel\n');

  if (argv.open) {
    await open(tunnel.url);
  }

  if (argv['print-requests']) {
    tunnel.on('request', info => {
      console.log(new Date().toString(), info.method, info.path);
    });
  }
})();
