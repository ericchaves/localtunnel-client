import { EventEmitter } from 'events';
import debugLib from 'debug';
import fs from 'fs';
import net from 'net';
import tls from 'tls';
import HeaderHostTransformer from './HeaderHostTransformer.js';
import HttpInspector from './HttpInspector.js';

const debug = debugLib('localtunnel:client');
const debugRequest = debugLib('localtunnel:inspect:request');
const debugResponse = debugLib('localtunnel:inspect:response');

// manages groups of tunnels
class TunnelCluster extends EventEmitter {
  constructor(opts = {}) {
    super(opts);
    this.opts = opts;
    this.closed = false;
    this.sockets = [];
    this.httpInspector = new HttpInspector();
  }

  open() {
    if (this.closed) {
      debug('tunnel cluster is closed, not opening');
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
    this.sockets.push({ remote, local: null });

    remote.on('error', err => {
      debug('got remote connection error', err.message);

      // emit connection refused errors immediately, because they
      // indicate that the tunnel can't be established.
      if (err.code === 'ECONNREFUSED') {
        this.emit(
          'error',
          new Error(
            `connection refused: ${remoteHostOrIp}:${remotePort} (check your firewall settings)`
          )
        );
      }

      remote.end();
    });

    const connLocal = () => {
      if (this.closed || remote.destroyed) {
        debug('remote destroyed or cluster closed');
        if (!this.closed) {
          this.emit('dead');
        }
        return;
      }

      debug('connecting locally to %s://%s:%d', localProtocol, localHost, localPort);
      remote.pause();

      if (allowInvalidCert) {
        debug('allowing invalid certificates');
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
        ? tls.connect({ host: localHost, port: localPort, ...getLocalCertOpts() })
        : net.connect({ host: localHost, port: localPort });

      const remoteClose = () => {
        debug('remote close');
        this.emit('dead');
        local.end();
      };

      remote.once('close', remoteClose);

      // TODO some languages have single threaded servers which makes opening up
      // multiple local connections impossible. We need a smarter way to scale
      // and adjust for such instances to avoid beating on the door of the server
      local.once('error', err => {
        debug('local error %s', err.message);
        local.end();

        remote.removeListener('close', remoteClose);

        if (err.code !== 'ECONNREFUSED'
            && err.code !== 'ECONNRESET') {
          return remote.end();
        }

        // retrying connection to local server
        if (!this.closed) {
          setTimeout(connLocal, 1000);
        }
      });

      local.once('connect', () => {
        debug('connected locally');
        remote.resume();

        let stream = remote;

        // if user requested specific local host
        // then we use host header transform to replace the host header
        if (opt.local_host) {
          debug('transform Host header to %s', opt.local_host);
          stream = remote.pipe(new HeaderHostTransformer({ host: opt.local_host }));
        }

        // Buffer to accumulate response data for inspection
        let responseBuffer = Buffer.alloc(0);

        // Intercept response data for inspection
        local.on('data', data => {
          // Accumulate data for inspection
          if (debugResponse.enabled) {
            responseBuffer = Buffer.concat([responseBuffer, data]);

            // Check if we have complete headers
            const headerEndIndex = responseBuffer.indexOf('\r\n\r\n');
            if (headerEndIndex !== -1) {
              // We have complete headers, log the response
              debugResponse(this.httpInspector.formatResponse(responseBuffer));
              // Reset buffer for next response
              responseBuffer = Buffer.alloc(0);
            }
          }
        });

        stream.pipe(local).pipe(remote);

        // when local closes, also get a new remote
        local.once('close', hadError => {
          debug('local connection closed [%s]', hadError);
        });
      });
    };

    // Buffer to accumulate request data for inspection
    let requestBuffer = Buffer.alloc(0);

    remote.on('data', data => {
      // Accumulate data for inspection
      if (debugRequest.enabled) {
        requestBuffer = Buffer.concat([requestBuffer, data]);

        // Check if we have complete headers
        const headerEndIndex = requestBuffer.indexOf('\r\n\r\n');
        if (headerEndIndex !== -1) {
          // We have complete headers, log the request
          debugRequest(this.httpInspector.formatRequest(requestBuffer));
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
    debug('closing tunnel cluster');
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
