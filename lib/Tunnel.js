/* eslint-disable consistent-return, no-underscore-dangle */

import { EventEmitter } from 'events';
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
    };
    /* eslint-enable camelcase */
  }

  // initialize connection
  // callback with connection info
  _init(cb) {
    const opt = this.opts;
    const getInfo = this._getInfo.bind(this);

    const params = {
      responseType: 'json',
    };

    const baseUri = `${opt.host}/`;
    // no subdomain at first, maybe use requested domain
    const assignedDomain = opt.subdomain;
    // where to quest
    const uri = baseUri + (assignedDomain || '?new');

    let retryCount = 0;
    const MAX_RETRIES = 3;

    (function getUrl() {
      axios
        .get(uri, params)
        .then(res => {
          const body = res.data;
          debug('got tunnel information', res.data);
          cb(null, getInfo(body));
        })
        .catch(err => {
          // Axios error structure: err.response contains HTTP response
          if (err.response) {
            // HTTP error from server (403, 409, 500, etc)
            const status = err.response.status;
            const body = err.response.data;
            const message = (body && body.message) || err.message;

            // 4xx errors: client errors, don't retry
            if (status >= 400 && status < 500) {
              debug(`client error ${status}: ${message}`);
              return cb(new Error(message));
            }

            // 5xx errors: server errors, retry with limit
            if (status >= 500) {
              retryCount++;
              if (retryCount >= MAX_RETRIES) {
                debug(`server error ${status} after ${retryCount} retries: ${message}`);
                return cb(new Error(`Server error after ${retryCount} retries: ${message}`));
              }
              debug(`server error ${status}, retry ${retryCount}/${MAX_RETRIES} in 1s`);
              return setTimeout(getUrl, 1000);
            }
          }

          // Network errors (ECONNREFUSED, ETIMEDOUT, etc): retry indefinitely
          debug(`tunnel server offline: ${err.message}, retry 1s`);
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
      debug('got socket error', err.message);
      this.emit('error', err);
    });

    let tunnelCount = 0;

    // track open count
    this.tunnelCluster.on('open', tunnel => {
      tunnelCount++;
      debug('tunnel open [total: %d]', tunnelCount);

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
    this.tunnelCluster.on('dead', () => {
      tunnelCount--;
      debug('tunnel dead [total: %d]', tunnelCount);
      if (this.closed) {
        return;
      }
      this.tunnelCluster.open();
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
