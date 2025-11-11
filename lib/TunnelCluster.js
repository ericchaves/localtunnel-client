import { EventEmitter } from 'events';
import debugLib from 'debug';
import fs from 'fs';
import net from 'net';
import tls from 'tls';
import HeaderHostTransformer from './HeaderHostTransformer.js';
import HttpInspector from './HttpInspector.js';

const debug = debugLib('localtunnel:cluster');

// manages groups of tunnels
class TunnelCluster extends EventEmitter {
  constructor(opts = {}) {
    super(opts);
    this.opts = opts;
    this.closed = false;
    this.sockets = [];

    // Initialize HttpInspector with optional dump directory
    this.httpInspector = new HttpInspector(opts.dump_dir);
    this.clientId = opts.client_id || 'unknown';
  }

  open() {
    if (this.closed) {
      debug('tunnel cluster is closed, not opening (clientId=%s)', this.clientId);
      return;
    }
    const opt = this.opts;

    // Prefer IP if returned by the server
    const remoteHostOrIp = opt.remote_ip || opt.remote_host;
    const remotePort = opt.remote_port;
    const localHost = opt.local_host || 'localhost';
    const localPort = opt.local_port;
    const localProtocol = opt.local_https ? 'https' : 'http';
    const allowInvalidCert = opt.allow_invalid_cert;

    debug(
      'establishing tunnel %s://%s:%s <> %s:%s',
      localProtocol,
      localHost,
      localPort,
      remoteHostOrIp,
      remotePort
    );

    // connection to localtunnel server
    const remote = net.connect({
      host: remoteHostOrIp,
      port: remotePort,
    });

    remote.setKeepAlive(true);

    // Track socket for cleanup
    this.sockets.push({ remote, local: null, deadEmitted: false });

    remote.on('error', err => {
      debug(
        'got remote connection error: %s [code=%s, remote=%s:%s]',
        err.message,
        err.code || 'UNKNOWN',
        remoteHostOrIp,
        remotePort
      );

      // emit connection refused errors immediately, because they
      // indicate that the tunnel can't be established.
      if (err.code === 'ECONNREFUSED') {
        this.emit(
          'error',
          new Error(
            `Connection refused: ${remoteHostOrIp}:${remotePort}\n💡 Troubleshooting:\n  - Check your firewall settings\n  - Verify the server is running\n  - Ensure you can reach the host (try: ping ${remoteHostOrIp})`
          )
        );
      } else if (err.code === 'ECONNRESET' && opt.max_conn) {
        // Connection reset - possibly because server reached connection limit
        this.emit(
          'error',
          new Error(
            `Connection reset by server (max connections: ${opt.max_conn})\n💡 This may indicate:\n  - Server reached connection limit\n  - Network instability\n  - Server restart`
          )
        );
      }

      remote.end();
    });

    // Variable to share snowflake ID between request and response handlers
    let currentSnowflakeId = null;

    const connLocal = () => {
      if (this.closed || remote.destroyed) {
        debug(
          'remote destroyed or cluster closed (destroyed=%s, closed=%s, clientId=%s)',
          remote.destroyed,
          this.closed,
          this.clientId
        );
        if (!this.closed) {
          // Find the socket pair and check if we already emitted 'dead'
          const socketPair = this.sockets.find(pair => pair.remote === remote);
          if (socketPair && !socketPair.deadEmitted) {
            socketPair.deadEmitted = true;
            this.emit('dead');
          }
        }
        return;
      }

      debug('connecting locally to %s://%s:%d', localProtocol, localHost, localPort);
      remote.pause();

      if (allowInvalidCert) {
        debug('allowing invalid certificates (INSECURE - use only for development)');
      }

      const getLocalCertOpts = () =>
        allowInvalidCert
          ? { rejectUnauthorized: false }
          : {
              cert: fs.readFileSync(opt.local_cert),
              key: fs.readFileSync(opt.local_key),
              ca: opt.local_ca ? [fs.readFileSync(opt.local_ca)] : undefined,
            };

      // connection to local http server
      const local = opt.local_https
        ? tls.connect({ host: localHost, port: localPort, ALPNProtocols: ['http/1.1'], ...getLocalCertOpts() })
        : net.connect({ host: localHost, port: localPort });

      const remoteClose = () => {
        const socketPair = this.sockets.find(pair => pair.remote === remote);
        debug(
          'remote close (localHost=%s:%d, willEmitDead=%s)',
          localHost,
          localPort,
          socketPair && !socketPair.deadEmitted
        );
        // Find the socket pair and check if we already emitted 'dead'
        if (socketPair && !socketPair.deadEmitted) {
          socketPair.deadEmitted = true;
          this.emit('dead');
        }
        local.end();
      };

      remote.once('close', remoteClose);

      // TODO some languages have single threaded servers which makes opening up
      // multiple local connections impossible. We need a smarter way to scale
      // and adjust for such instances to avoid beating on the door of the server
      local.once('error', err => {
        const willRetry =
          (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') && !this.closed;
        debug(
          'local error: %s [code=%s, localHost=%s:%d, willRetry=%s]',
          err.message,
          err.code,
          localHost,
          localPort,
          willRetry
        );
        local.end();

        remote.removeListener('close', remoteClose);

        if (err.code !== 'ECONNREFUSED' && err.code !== 'ECONNRESET') {
          return remote.end();
        }

        // retrying connection to local server
        if (!this.closed) {
          setTimeout(connLocal, 1000);
        }
      });

      local.once('connect', () => {
        debug('connected locally to %s://%s:%d', localProtocol, localHost, localPort);
        remote.resume();

        let stream = remote;

        // if user requested specific local host
        // then we use host header transform to replace the host header
        if (opt.local_host) {
          debug('transform Host header from server default to %s', opt.local_host);
          stream = remote.pipe(new HeaderHostTransformer({ host: opt.local_host }));
        }

        // Buffer to accumulate response data for dumping
        let responseBuffer = Buffer.alloc(0);
        let responseComplete = false;

        // Intercept response data for dumping
        local.on('data', data => {
          // Accumulate data for dumping
          if (this.httpInspector.dumpDir && !responseComplete) {
            responseBuffer = Buffer.concat([responseBuffer, data]);

            // Check if we have complete headers
            const headerEndIndex = responseBuffer.indexOf('\r\n\r\n');
            if (headerEndIndex !== -1) {
              // Parse headers to check for chunked encoding
              const headerSection = responseBuffer.toString('utf8', 0, headerEndIndex);
              const isChunked = /transfer-encoding:\s*chunked/i.test(headerSection);

              let shouldDump = false;

              if (isChunked) {
                // For chunked responses, check if we have the final chunk marker
                if (responseBuffer.indexOf('\r\n0\r\n\r\n', headerEndIndex) !== -1) {
                  shouldDump = true;
                  responseComplete = true;
                }
              } else {
                // For non-chunked responses, check Content-Length
                const contentLengthMatch = headerSection.match(/content-length:\s*(\d+)/i);
                if (contentLengthMatch) {
                  const contentLength = parseInt(contentLengthMatch[1], 10);
                  const bodyStart = headerEndIndex + 4;
                  const currentBodyLength = responseBuffer.length - bodyStart;

                  if (currentBodyLength >= contentLength) {
                    shouldDump = true;
                    responseComplete = true;
                  }
                } else {
                  // No content-length and not chunked - dump what we have after headers
                  shouldDump = true;
                  responseComplete = true;
                }
              }

              if (shouldDump && currentSnowflakeId) {
                this.httpInspector.dumpResponse(responseBuffer, this.clientId, currentSnowflakeId);
                responseBuffer = Buffer.alloc(0);
                responseComplete = false; // Reset for next response
              }
            }
          }
        });

        stream.pipe(local).pipe(remote);

        // when local closes, also close remote to trigger reconnection
        local.once('close', hadError => {
          debug(
            'local connection closed [hadError=%s, localHost=%s:%d, closing remote]',
            hadError,
            localHost,
            localPort
          );
          // Close remote connection to trigger 'dead' event and reconnection flow
          if (!remote.destroyed) {
            remote.end();
          }
        });
      });
    };

    // Buffer to accumulate request data for dumping
    let requestBuffer = Buffer.alloc(0);

    remote.on('data', data => {
      // Accumulate data for dumping
      if (this.httpInspector.dumpDir) {
        requestBuffer = Buffer.concat([requestBuffer, data]);

        // Check if we have complete headers
        const headerEndIndex = requestBuffer.indexOf('\r\n\r\n');
        if (headerEndIndex !== -1) {
          // Dump request if dumper is enabled
          currentSnowflakeId = this.httpInspector.dumpRequest(requestBuffer, this.clientId);

          // Reset buffer for next request
          requestBuffer = Buffer.alloc(0);
        }
      }

      // Original request event emission
      const match = data.toString().match(/^(\w+) (\S+)/);
      if (match) {
        this.emit('request', {
          method: match[1],
          path: match[2],
        });
      }
    });

    // tunnel is considered open when remote connects
    remote.once('connect', () => {
      this.emit('open', remote);
      connLocal();
    });
  }

  close() {
    debug('closing tunnel cluster (clientId=%s, activeSockets=%d)', this.clientId, this.sockets.length);
    this.closed = true;

    // Destroy all sockets
    for (const socketPair of this.sockets) {
      if (socketPair.remote && !socketPair.remote.destroyed) {
        socketPair.remote.destroy();
      }
      if (socketPair.local && !socketPair.local.destroyed) {
        socketPair.local.destroy();
      }
    }

    // Clear socket array
    this.sockets = [];

    // Remove all listeners to prevent memory leaks
    this.removeAllListeners();
  }
}

export default TunnelCluster;
