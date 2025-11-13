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

    // Track consecutive failures when connecting to local service
    // Shared across all tunnels to detect when service is completely down
    this.consecutiveLocalFailures = 0;
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
          'remote close (localHost=%s:%d, willEmitDead=%s, consecutive_failures=%d)',
          localHost,
          localPort,
          socketPair && !socketPair.deadEmitted,
          this.consecutiveLocalFailures
        );

        // Find the socket pair and check if we already emitted 'dead'
        if (socketPair && !socketPair.deadEmitted) {
          socketPair.deadEmitted = true;

          // Check consecutive failures to decide if tunnel should be retriable
          const maxConsecutiveFailures = 10;
          if (this.consecutiveLocalFailures >= maxConsecutiveFailures) {
            // Too many failures - service is down, don't create new tunnels
            this.emit('dead', { retriable: false });
          } else {
            // Legitimate remote issue, can create new tunnel
            this.emit('dead', { retriable: true });
          }
        }

        if (!local.destroyed) {
          local.end();
        }
      };

      remote.once('close', remoteClose);

      // TODO some languages have single threaded servers which makes opening up
      // multiple local connections impossible. We need a smarter way to scale
      // and adjust for such instances to avoid beating on the door of the server
      local.once('error', err => {
        debug(
          'local error: %s [code=%s, localHost=%s:%d, consecutive_failures=%d]',
          err.message,
          err.code,
          localHost,
          localPort,
          this.consecutiveLocalFailures + 1
        );
        local.end();

        remote.removeListener('close', remoteClose);

        if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
          // Increment consecutive failure counter
          this.consecutiveLocalFailures++;

          // Check if we've exceeded the maximum consecutive failures
          const maxConsecutiveFailures = 10;
          if (this.consecutiveLocalFailures >= maxConsecutiveFailures) {
            debug(
              'max consecutive failures reached [%d], marking tunnel as dead',
              this.consecutiveLocalFailures
            );

            // Emit dead with retriable=false to stop creating new tunnels
            const socketPair = this.sockets.find(pair => pair.remote === remote);
            if (socketPair && !socketPair.deadEmitted) {
              socketPair.deadEmitted = true;
              this.emit('dead', { retriable: false });
            }

            return remote.end();
          }

          // Retry connection to local server after delay
          debug(
            'retrying local connection in 1s [attempt %d/%d]',
            this.consecutiveLocalFailures,
            maxConsecutiveFailures
          );

          if (!this.closed && !remote.destroyed) {
            setTimeout(() => {
              if (!this.closed && !remote.destroyed) {
                connLocal();
              }
            }, 1000);
          }
        } else {
          // Other errors: don't retry
          return remote.end();
        }
      });

      local.once('connect', () => {
        debug('connected locally to %s://%s:%d', localProtocol, localHost, localPort);

        // Reset consecutive failure counter on successful connection
        if (this.consecutiveLocalFailures > 0) {
          debug(
            'resetting consecutive failure counter [was=%d, now=0]',
            this.consecutiveLocalFailures
          );
          this.consecutiveLocalFailures = 0;
        }

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

        // when local closes, handle reconnection based on error status
        local.once('close', hadError => {
          const shouldReconnect = this.opts.local_reconnect !== false;

          debug(
            'local closed [hadError=%s, localHost=%s:%d, consecutive_failures=%d, reconnect=%s]',
            hadError,
            localHost,
            localPort,
            this.consecutiveLocalFailures,
            shouldReconnect
          );

          // Cleanup listeners and pipes
          remote.removeListener('close', remoteClose);
          if (stream && stream !== remote) {
            stream.unpipe(local);
          }
          local.unpipe(remote);

          // Check if reconnection is disabled
          if (!shouldReconnect) {
            debug(
              'local reconnection disabled, closing remote tunnel [localHost=%s:%d, clientId=%s]',
              localHost,
              localPort,
              this.clientId
            );

            // Emit 'dead' but mark as non-retriable
            const socketPair = this.sockets.find(pair => pair.remote === remote);
            if (socketPair && !socketPair.deadEmitted) {
              socketPair.deadEmitted = true;
              this.emit('dead', { retriable: false });
            }

            if (!remote.destroyed) {
              remote.end();
            }
            return;
          }

          // Decide whether to reconnect based on error status
          if (!hadError) {
            // Close was NORMAL (request processed successfully)
            // Reset failure counter and reconnect immediately for next request
            if (this.consecutiveLocalFailures > 0) {
              debug('resetting consecutive failures after successful close');
              this.consecutiveLocalFailures = 0;
            }

            if (!this.closed && !remote.destroyed) {
              debug('reconnecting local immediately for next request');
              connLocal(); // Reconnect immediately, no delay
            }
          } else {
            // Close had ERROR (hadError=true)
            // Increment counter and check limit
            this.consecutiveLocalFailures++;

            const maxConsecutiveFailures = 10;
            if (this.consecutiveLocalFailures >= maxConsecutiveFailures) {
              debug(
                'max consecutive failures on close [%d], marking tunnel as dead',
                this.consecutiveLocalFailures
              );

              const socketPair = this.sockets.find(pair => pair.remote === remote);
              if (socketPair && !socketPair.deadEmitted) {
                socketPair.deadEmitted = true;
                this.emit('dead', { retriable: false });
              }

              if (!remote.destroyed) {
                remote.end();
              }
              return;
            }

            // Retry after delay when there's an error
            if (!this.closed && !remote.destroyed) {
              debug(
                'retrying local after error close in 1s [attempt %d/%d]',
                this.consecutiveLocalFailures,
                maxConsecutiveFailures
              );

              setTimeout(() => {
                if (!this.closed && !remote.destroyed) {
                  connLocal();
                }
              }, 1000);
            }
          }
        });
      });
    };

    // Buffer to accumulate request data for dumping
    let requestBuffer = Buffer.alloc(0);

    remote.on('data', data => {
      // Check for X-LT-Source: server header to skip server-originated messages
      const dataStr = data.toString('utf8');
      const headerMatch = dataStr.match(/\r\nX-LT-Source:\s*server\s*\r\n/i);

      if (headerMatch) {
        debug('skipping server-originated message (X-LT-Source: server detected)');
        // Reset buffer and skip processing
        if (this.httpInspector.dumpDir) {
          requestBuffer = Buffer.alloc(0);
        }
        return;
      }

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

    // Reset consecutive failure counter
    this.consecutiveLocalFailures = 0;

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
