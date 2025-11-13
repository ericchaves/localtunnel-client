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

    // Separate counters for different error types
    this.connectionRefusedCount = 0;  // ECONNREFUSED - service not running
    this.connectionDroppedCount = 0;  // Errors after connection established

    // Time-based failure tracking with sliding window
    this.failureTimestamps = [];  // Array of failure timestamps
    this.totalFailureCount = 0;   // Total failures across all time
    this.failureWindow = 60000;   // 60 second window
    this.maxFailuresInWindow = this.opts.local_retry_max || 10;  // Max failures in window
    this.maxTotalFailures = 50;   // Absolute safety limit

    // Exponential backoff for local reconnection
    this.localReconnectDelay = 1000; // Start at 1 second
    this.maxLocalReconnectDelay = 10000; // Cap at 10 seconds
  }

  /**
   * Record a failure and check if we've exceeded any limits
   * @returns {boolean} true if we should give up, false if we should retry
   */
  _recordFailureAndCheckLimits() {
    const now = Date.now();

    // Record this failure
    this.failureTimestamps.push(now);
    this.totalFailureCount++;

    // Remove failures outside the sliding window
    this.failureTimestamps = this.failureTimestamps.filter(
      ts => now - ts < this.failureWindow
    );

    const failuresInWindow = this.failureTimestamps.length;

    debug(
      'failure recorded [in_window=%d/%d, total=%d/%d, window=%ds]',
      failuresInWindow,
      this.maxFailuresInWindow,
      this.totalFailureCount,
      this.maxTotalFailures,
      this.failureWindow / 1000
    );

    // Check limits
    if (failuresInWindow >= this.maxFailuresInWindow) {
      debug('exceeded max failures in time window (%d failures in %ds)', failuresInWindow, this.failureWindow / 1000);
      return true; // Give up
    }

    if (this.totalFailureCount >= this.maxTotalFailures) {
      debug('exceeded absolute failure limit (%d total failures)', this.totalFailureCount);
      return true; // Give up
    }

    return false; // Can retry
  }

  open() {
    if (this.closed) {
      debug('tunnel cluster is closed, not opening (clientId=%s)', this.clientId);
      return;
    }

    // Reset failure counters for each new tunnel instance
    // This prevents accumulation of failures across different tunnel connections
    this.consecutiveLocalFailures = 0;
    this.connectionRefusedCount = 0;
    this.connectionDroppedCount = 0;
    this.failureTimestamps = [];
    this.totalFailureCount = 0;
    this.localReconnectDelay = 1000; // Reset backoff delay
    debug('reset consecutive failures counters and backoff delay for new tunnel');

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
          // Use configured value or default to 10
          const maxConsecutiveFailures = this.opts.local_retry_max || 10;
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
          // Increment appropriate failure counter based on error type
          if (err.code === 'ECONNREFUSED') {
            this.connectionRefusedCount++;
          }
          this.consecutiveLocalFailures++;

          // Record failure in time-based tracking
          const shouldGiveUp = this._recordFailureAndCheckLimits();

          // Check if we've exceeded the maximum consecutive failures
          // Use configured value or default to 10
          const maxConsecutiveFailures = this.opts.local_retry_max || 10;
          // For ECONNREFUSED, be stricter (service is down)
          const maxRefused = this.opts.local_retry_max || 10;

          if (shouldGiveUp ||
              this.consecutiveLocalFailures >= maxConsecutiveFailures ||
              this.connectionRefusedCount >= maxRefused) {
            debug(
              'max consecutive failures reached [total=%d, refused=%d], marking tunnel as dead',
              this.consecutiveLocalFailures,
              this.connectionRefusedCount
            );

            // Emit dead with retriable=false to stop creating new tunnels
            const socketPair = this.sockets.find(pair => pair.remote === remote);
            if (socketPair && !socketPair.deadEmitted) {
              socketPair.deadEmitted = true;
              this.emit('dead', { retriable: false });
            }

            return remote.end();
          }

          // Retry connection to local server with exponential backoff
          debug(
            'retrying local connection in %dms [attempt %d/%d]',
            this.localReconnectDelay,
            this.consecutiveLocalFailures,
            maxConsecutiveFailures
          );

          if (!this.closed && !remote.destroyed) {
            setTimeout(() => {
              if (!this.closed && !remote.destroyed) {
                connLocal();
              }
            }, this.localReconnectDelay);

            // Increase delay for next attempt (exponential backoff with 1.5x multiplier)
            const prevDelay = this.localReconnectDelay;
            this.localReconnectDelay = Math.min(
              this.localReconnectDelay * 1.5,
              this.maxLocalReconnectDelay
            );
            debug('local reconnect delay increased from %dms to %dms', prevDelay, this.localReconnectDelay);
          }
        } else {
          // Other errors: don't retry
          return remote.end();
        }
      });

      local.once('connect', () => {
        debug('connected locally to %s://%s:%d', localProtocol, localHost, localPort);

        // Reset all failure counters on successful connection
        if (this.consecutiveLocalFailures > 0 || this.connectionRefusedCount > 0 || this.connectionDroppedCount > 0) {
          debug(
            'resetting failure counters [total=%d, refused=%d, dropped=%d -> all 0]',
            this.consecutiveLocalFailures,
            this.connectionRefusedCount,
            this.connectionDroppedCount
          );
          this.consecutiveLocalFailures = 0;
          this.connectionRefusedCount = 0;
          this.connectionDroppedCount = 0;
        }

        // Reset backoff delay on successful connection
        if (this.localReconnectDelay > 1000) {
          debug('resetting local reconnect delay [was=%dms, now=1000ms]', this.localReconnectDelay);
          this.localReconnectDelay = 1000;
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
            // Reset all failure counters and reconnect immediately for next request
            if (this.consecutiveLocalFailures > 0 || this.connectionRefusedCount > 0 || this.connectionDroppedCount > 0) {
              debug('resetting all failure counters after successful close');
              this.consecutiveLocalFailures = 0;
              this.connectionRefusedCount = 0;
              this.connectionDroppedCount = 0;
            }

            if (!this.closed && !remote.destroyed) {
              debug('reconnecting local immediately for next request');
              connLocal(); // Reconnect immediately, no delay
            }
          } else {
            // Close had ERROR (hadError=true)
            // Increment counters and check limit
            this.consecutiveLocalFailures++;
            this.connectionDroppedCount++; // Connection dropped after being established

            // Record failure in time-based tracking
            const shouldGiveUp = this._recordFailureAndCheckLimits();

            // Use configured value or default to 10
            const maxConsecutiveFailures = this.opts.local_retry_max || 10;
            // More lenient for dropped connections (service might be under load)
            const maxDropped = Math.ceil((this.opts.local_retry_max || 10) * 2);

            if (shouldGiveUp ||
                this.consecutiveLocalFailures >= maxConsecutiveFailures ||
                this.connectionDroppedCount >= maxDropped) {
              debug(
                'max consecutive failures on close [total=%d, dropped=%d], marking tunnel as dead',
                this.consecutiveLocalFailures,
                this.connectionDroppedCount
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

            // Retry after delay when there's an error (with exponential backoff)
            if (!this.closed && !remote.destroyed) {
              debug(
                'retrying local after error close in %dms [attempt %d/%d]',
                this.localReconnectDelay,
                this.consecutiveLocalFailures,
                maxConsecutiveFailures
              );

              setTimeout(() => {
                if (!this.closed && !remote.destroyed) {
                  connLocal();
                }
              }, this.localReconnectDelay);

              // Increase delay for next attempt (exponential backoff with 1.5x multiplier)
              const prevDelay = this.localReconnectDelay;
              this.localReconnectDelay = Math.min(
                this.localReconnectDelay * 1.5,
                this.maxLocalReconnectDelay
              );
              debug('local reconnect delay increased from %dms to %dms', prevDelay, this.localReconnectDelay);
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

    // Reset all failure counters
    this.consecutiveLocalFailures = 0;
    this.connectionRefusedCount = 0;
    this.connectionDroppedCount = 0;
    this.failureTimestamps = [];
    this.totalFailureCount = 0;

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
