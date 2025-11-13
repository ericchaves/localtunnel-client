/* eslint-disable consistent-return, no-underscore-dangle */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import axios from 'axios';
import debugLib from 'debug';
import TunnelCluster from './TunnelCluster.js';

const debug = debugLib('localtunnel:client');

class Tunnel extends EventEmitter {
  constructor(opts = {}) {
    super(opts);
    this.opts = opts;
    this.closed = false;
    if (!this.opts.host) {
      this.opts.host = 'https://localtunnel.me';
    }
  }

  _getInfo(body) {
    /* eslint-disable camelcase */
    const { id, ip, port, url, cached_url, max_conn_count } = body;
    const { host, port: local_port, local_host } = this.opts;
    const { local_https, local_cert, local_key, local_ca, allow_invalid_cert } = this.opts;
    const { print_requests, dump_dir, local_reconnect, local_retry_max } = this.opts;
    return {
      name: id,
      url,
      cached_url,
      max_conn: max_conn_count || 1,
      remote_host: new URL(host).hostname,
      remote_ip: ip,
      remote_port: port,
      local_port,
      local_host,
      local_https,
      local_cert,
      local_key,
      local_ca,
      allow_invalid_cert,
      print_requests,
      dump_dir,
      local_reconnect: local_reconnect !== false,
      local_retry_max: local_retry_max || 0,
      client_id: id,
    };
    /* eslint-enable camelcase */
  }

  /**
   * Validate client token format (Protocol 0.0.9-epc)
   * @param {string} token - Client token to validate
   * @returns {boolean} true if valid
   * @throws {Error} if token is invalid
   */
  _validateClientToken(token) {
    if (!token) {
      return true; // Token is optional
    }

    if (typeof token !== 'string') {
      throw new Error(`clientToken must be a string (received: ${typeof token})`);
    }

    if (token.length > 256) {
      throw new Error(`clientToken must not exceed 256 characters (length: ${token.length})`);
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(token)) {
      throw new Error(
        `clientToken must contain only alphanumeric characters, hyphens, and underscores (received: "${token}")`
      );
    }

    return true;
  }

  /**
   * Validate HMAC secret (Protocol 0.0.10-epc)
   * @param {string} secret - HMAC secret to validate
   * @returns {boolean} true if valid
   * @throws {Error} if secret is invalid
   */
  _validateHmacSecret(secret) {
    if (!secret) {
      return true; // HMAC is optional
    }

    if (typeof secret !== 'string') {
      throw new Error(`hmacSecret must be a string (received: ${typeof secret})`);
    }

    if (secret.length < 32) {
      throw new Error(
        `hmacSecret must be at least 32 characters long for security (length: ${secret.length})`
      );
    }

    return true;
  }

  /**
   * Calculate HMAC-SHA256 signature (Protocol 0.0.10-epc)
   * @param {string} method - HTTP method (e.g., 'GET')
   * @param {string} path - Request path (e.g., '/subdomain' or '/?new')
   * @param {string} secret - HMAC secret key
   * @returns {object} Object with signature, timestamp, and nonce
   */
  _calculateHmacSignature(method, path, secret) {
    // Generate timestamp (Unix seconds)
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Generate nonce (Unix milliseconds)
    const nonce = Date.now().toString();

    // Body is empty for GET requests
    const body = '';

    // Build message: METHOD + PATH + TIMESTAMP + NONCE + BODY
    const message = `${method}${path}${timestamp}${nonce}${body}`;

    // Calculate HMAC-SHA256 signature
    const signature = crypto
      .createHmac('sha256', secret)
      .update(message)
      .digest('hex');

    debug(
      'HMAC signature calculated for %s %s (timestamp=%s, nonce=%s, sig=%s...)',
      method,
      path,
      timestamp,
      nonce,
      signature.substring(0, 8)
    );

    return { signature, timestamp, nonce };
  }

  // initialize connection
  // callback with connection info
  _init(cb) {
    const opt = this.opts;
    const getInfo = this._getInfo.bind(this);

    // Validate client token if provided (Protocol 0.0.9-epc)
    if (opt.clientToken) {
      try {
        this._validateClientToken(opt.clientToken);
      } catch (err) {
        return cb(err);
      }
    }

    // Validate HMAC secret if provided (Protocol 0.0.10-epc)
    if (opt.hmacSecret) {
      try {
        this._validateHmacSecret(opt.hmacSecret);
      } catch (err) {
        return cb(err);
      }
    }

    const params = {
      responseType: 'json',
      headers: {},
    };

    const baseUri = `${opt.host}/`;
    // no subdomain at first, maybe use requested domain
    const assignedDomain = opt.subdomain;
    // where to quest
    const uri = baseUri + (assignedDomain || '?new');

    // Add Client Token header if provided (Protocol 0.0.9-epc)
    if (opt.clientToken) {
      params.headers['X-LT-Client-Token'] = opt.clientToken;
      debug(
        'using client token authentication (token=%s..., subdomain=%s)',
        opt.clientToken.substring(0, 8),
        assignedDomain || 'auto'
      );
    }

    // Add HMAC authentication headers if secret provided (Protocol 0.0.10-epc)
    if (opt.hmacSecret) {
      const method = 'GET';
      const path = assignedDomain ? `/${assignedDomain}` : '/?new';
      const { signature, timestamp, nonce } = this._calculateHmacSignature(
        method,
        path,
        opt.hmacSecret
      );

      params.headers['Authorization'] = `HMAC sha256=${signature}`;
      params.headers['X-Timestamp'] = timestamp;
      params.headers['X-Nonce'] = nonce;
      debug('using HMAC authentication (sha256, headers: Authorization, X-Timestamp, X-Nonce)');
    }

    let retryCount = 0;
    const MAX_RETRIES = 3;

    (function getUrl() {
      axios
        .get(uri, params)
        .then(res => {
          const body = res.data;
          debug(
            'got tunnel information: id=%s, url=%s, max_conn=%d, ip=%s:%d',
            res.data.id,
            res.data.url,
            res.data.max_conn_count,
            res.data.ip,
            res.data.port
          );
          cb(null, getInfo(body));
        })
        .catch(err => {
          // Axios error structure: err.response contains HTTP response
          if (err.response) {
            // HTTP error from server (403, 409, 500, etc)
            const status = err.response.status;
            const headers = err.response.headers || {};
            const body = err.response.data;
            const message = (body && body.message) || err.message;

            // Handle 429 Too Many Connections specially (Protocol 0.0.10-epc)
            if (status === 429) {
              const maxSockets = headers['x-lt-max-sockets'];
              const currentSockets = headers['x-lt-current-sockets'];
              const availableSockets = headers['x-lt-available-sockets'];
              const waitingRequests = headers['x-lt-waiting-requests'];

              const details = [
                message,
                maxSockets && `Max allowed: ${maxSockets}`,
                currentSockets && `Currently connected: ${currentSockets}`,
                availableSockets && `Available: ${availableSockets}`,
                waitingRequests && `Waiting: ${waitingRequests}`
              ].filter(Boolean).join(' | ');

              debug(`rate limited: ${details}`);
              return cb(new Error(`Too many connections - ${details}`));
            }

            // 4xx errors: client errors, don't retry
            if (status >= 400 && status < 500) {
              debug(
                `client error ${status}: ${message} (url=%s, subdomain=%s, auth=%s)`,
                uri,
                assignedDomain || 'auto',
                opt.clientToken ? 'token' : opt.hmacSecret ? 'hmac' : 'none'
              );

              const errorMsg = `HTTP ${status}: ${message}`;
              if (status === 403) {
                return cb(
                  new Error(
                    `${errorMsg}\n💡 Possible causes:\n  - Invalid subdomain format\n  - Subdomain restricted by server\n  - Authentication required`
                  )
                );
              } else if (status === 409) {
                return cb(
                  new Error(
                    `${errorMsg}\n💡 This subdomain is already in use. Try:\n  - Different subdomain\n  - Using client token authentication`
                  )
                );
              }
              return cb(new Error(errorMsg));
            }

            // 5xx errors: server errors, retry with limit
            if (status >= 500) {
              retryCount++;
              if (retryCount >= MAX_RETRIES) {
                debug(
                  `server error ${status} after ${retryCount} retries: ${message} (total time: ~${retryCount}s)`
                );
                return cb(
                  new Error(
                    `Server error ${status} after ${retryCount} retries: ${message}\n💡 The tunnel server is experiencing issues. Try:\n  - Wait a few minutes\n  - Use a different server with --host\n  - Check ${opt.host} status`
                  )
                );
              }
              debug(`server error ${status}, retry ${retryCount}/${MAX_RETRIES} in 1s (url=%s)`, uri);
              return setTimeout(getUrl, 1000);
            }
          }

          // Network errors (ECONNREFUSED, ETIMEDOUT, etc): retry indefinitely
          debug(
            `tunnel server offline: ${err.code || 'NETWORK_ERROR'} - ${err.message} (host=%s, retrying in 1s)`,
            opt.host
          );
          return setTimeout(getUrl, 1000);
        });
    })();
  }

  _establish(info) {
    // increase max event listeners so that localtunnel consumers don't get
    // warning messages as soon as they setup even one listener. See #71
    this.setMaxListeners(info.max_conn + (EventEmitter.defaultMaxListeners || 10));

    this.tunnelCluster = new TunnelCluster(info);

    // only emit the url the first time
    this.tunnelCluster.once('open', () => {
      this.emit('url', info.url);
    });

    // re-emit socket error
    this.tunnelCluster.on('error', err => {
      debug(
        '[%s] got socket error: %s [code=%s, state=%s]',
        this.clientId || 'unknown',
        err.message,
        err.code || 'UNKNOWN',
        this.tunnelCluster.closed ? 'closed' : 'open'
      );
      this.emit('error', err);
    });

    let tunnelCount = 0;
    let reconnectDelay = 1000; // Start with 1 second
    const MAX_RECONNECT_DELAY = 30000; // Maximum 30 seconds

    // track open count
    this.tunnelCluster.on('open', tunnel => {
      tunnelCount++;
      debug('[%s] tunnel open [total: %d/%d]', this.clientId, tunnelCount, info.max_conn);

      // Reset backoff delay on successful connection
      reconnectDelay = 1000;

      const closeHandler = () => {
        tunnel.destroy();
      };

      if (this.closed) {
        return closeHandler();
      }

      this.once('close', closeHandler);
      tunnel.once('close', () => {
        this.removeListener('close', closeHandler);
      });
    });

    // when a tunnel dies, open a new one
    this.tunnelCluster.on('dead', (eventInfo = {}) => {
      tunnelCount--;
      const retriable = eventInfo.retriable !== false; // default true
      const willReconnect = retriable && tunnelCount < info.max_conn && !this.closed;

      debug(
        '[%s] tunnel dead [total: %d, willReconnect=%s, closed=%s, retriable=%s]',
        this.clientId,
        tunnelCount,
        willReconnect,
        this.closed,
        retriable
      );

      if (this.closed) {
        return;
      }

      // If not retriable (local reconnect disabled or max retries reached),
      // don't open a new tunnel to the server
      if (!retriable) {
        debug(
          '[%s] tunnel marked as non-retriable, not opening new connection [total: %d/%d]',
          this.clientId,
          tunnelCount,
          info.max_conn
        );

        // If all tunnels are dead and none are retriable, close the client
        if (tunnelCount === 0) {
          debug('[%s] all tunnels dead and non-retriable, closing client', this.clientId);
          this.close();
          // Emit exit event instead of calling process.exit() directly
          // This allows the CLI wrapper to handle exit, and makes the library testable
          this.emit('exit', { code: 0, reason: 'all_tunnels_dead' });
        }
        return;
      }

      // Only open new connection if we're below the limit (Fase 1 fix)
      if (tunnelCount < info.max_conn) {
        // Exponential backoff to prevent connection storms (Fase 2 enhancement)
        setTimeout(() => {
          if (!this.closed && tunnelCount < info.max_conn) {
            this.tunnelCluster.open();
          }
        }, reconnectDelay);

        // Increase delay for next attempt (exponential backoff)
        const prevDelay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        debug('[%s] reconnect delay increased to %dms (was %dms)', this.clientId, reconnectDelay, prevDelay);
      } else {
        debug('[%s] already at max connections (%d), not opening new tunnel', this.clientId, info.max_conn);
      }
    });

    this.tunnelCluster.on('request', req => {
      this.emit('request', req);
    });

    // establish as many tunnels as allowed
    for (let count = 0; count < info.max_conn; ++count) {
      this.tunnelCluster.open();
    }
  }

  open(cb) {
    this._init((err, info) => {
      if (err) {
        return cb(err);
      }

      this.clientId = info.name;
      this.url = info.url;

      // `cached_url` is only returned by proxy servers that support resource caching.
      if (info.cached_url) {
        this.cachedUrl = info.cached_url;
      }

      this._establish(info);
      cb();
    });
  }

  close() {
    this.closed = true;
    if (this.tunnelCluster) {
      this.tunnelCluster.close();
    }
    this.emit('close');
  }
}

export default Tunnel;
