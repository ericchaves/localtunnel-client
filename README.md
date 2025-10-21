# localtunnel-client

localtunnel exposes your localhost to the world for easy testing and sharing! No need to mess with DNS or deploy just to have others test out your changes.

Great for working with browser testing tools like browserling or external api callback services like twilio which require a public url for callbacks.

## Quickstart

```
npx localtunnel --port 8000
```

## Installation

**ATTENTION:** _installation methods mentioned below refer to the [official localtunnel](//github.com/localtunnel/localtunnel) client, not our updated version._

### Globally

```
npm install -g localtunnel
```

### As a dependency in your project

```
yarn add localtunnel
```

### Homebrew

```bash
brew install localtunnel
```

## CLI usage

When localtunnel is installed globally, just use the `lt` command to start the tunnel.

```
lt --port 8000
```

That's it! It will connect to the tunnel server, setup the tunnel, and tell you what url to use for your testing. This url will remain active for the duration of your session; so feel free to share it with others for happy fun time!

You can restart your local server all you want, `lt` is smart enough to detect this and reconnect once it is back.

### Arguments

Below are some common arguments. See `lt --help` for additional arguments

- `--subdomain` request a named subdomain on the localtunnel server (default is random characters)
- `--local-host` proxy to a hostname other than localhost

You may also specify arguments via env variables. e.g.

```
PORT=3000 lt
```

### Environment Variables

All CLI options can be set via environment variables. The variable name is the option name in uppercase with hyphens replaced by underscores:

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `PORT` | Internal HTTP server port | - | `PORT=3000` |
| `HOST` | Upstream server providing forwarding | `https://localtunnel.me` | `HOST=https://custom.server.com` |
| `SUBDOMAIN` | Request a specific subdomain | random | `SUBDOMAIN=myapp` |
| `LOCAL_HOST` | Tunnel traffic to this host instead of localhost | `localhost` | `LOCAL_HOST=192.168.1.100` |
| `LOCAL_HTTPS` | Tunnel traffic to a local HTTPS server | `false` | `LOCAL_HTTPS=true` |
| `LOCAL_CERT` | Path to certificate PEM file for local HTTPS | - | `LOCAL_CERT=/path/to/cert.pem` |
| `LOCAL_KEY` | Path to certificate key file for local HTTPS | - | `LOCAL_KEY=/path/to/key.pem` |
| `LOCAL_CA` | Path to certificate authority file | - | `LOCAL_CA=/path/to/ca.pem` |
| `ALLOW_INVALID_CERT` | Disable certificate checks for local HTTPS | `false` | `ALLOW_INVALID_CERT=true` |
| `OPEN` | Opens the tunnel URL in your browser | `false` | `OPEN=true` |
| `PRINT_REQUESTS` | Print basic request info | `false` | `PRINT_REQUESTS=true` |

#### Debug Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `DEBUG` | Enable debug output (see [DEBUG_INSPECTION.md](docs/DEBUG_INSPECTION.md)) | - | `DEBUG=localtunnel:*` |
| `INSPECT_BODY_PREVIEW_SIZE` | Maximum bytes to preview for text/XML bodies | `500` | `INSPECT_BODY_PREVIEW_SIZE=1000` |

#### Self-Signed Certificates

> **Note:** To connect to servers using HTTPS with self-signed certificates or certificates from unrecognized CAs, you need to set the Node.js environment variable `NODE_TLS_REJECT_UNAUTHORIZED='0'`.
>
> **Warning:** This disables TLS certificate validation and should only be used in development/testing environments. Never use this in production as it makes your connection vulnerable to man-in-the-middle attacks.

**Example:**

```bash
NODE_TLS_REJECT_UNAUTHORIZED='0' lt --host https://my-server. --port 3000
```

**Example with multiple variables:**

```bash
PORT=3000 SUBDOMAIN=myapp DEBUG=localtunnel:* lt
```

## API

The localtunnel client is also usable through an API (for test integration, automation, etc)

### localtunnel(port [,options][,callback])

Creates a new localtunnel to the specified local `port`. Will return a Promise that resolves once you have been assigned a public localtunnel url. `options` can be used to request a specific `subdomain`. A `callback` function can be passed, in which case it won't return a Promise. This exists for backwards compatibility with the old Node-style callback API. You may also pass a single options object with `port` as a property.

```js
const localtunnel = require("localtunnel");

(async () => {
  const tunnel = await localtunnel({ port: 3000 });

  // the assigned public url for your tunnel
  // i.e. https://abcdefgjhij.localtunnel.me
  tunnel.url;

  tunnel.on("close", () => {
    // tunnels are closed
  });
})();
```

#### options

- `port` (number) [required] The local port number to expose through localtunnel.
- `subdomain` (string) Request a specific subdomain on the proxy server. **Note** You may not actually receive this name depending on availability.
- `host` (string) URL for the upstream proxy server. Defaults to `https://localtunnel.me`.
- `local_host` (string) Proxy to this hostname instead of `localhost`. This will also cause the `Host` header to be re-written to this value in proxied requests.
- `local_https` (boolean) Enable tunneling to local HTTPS server.
- `local_cert` (string) Path to certificate PEM file for local HTTPS server.
- `local_key` (string) Path to certificate key file for local HTTPS server.
- `local_ca` (string) Path to certificate authority file for self-signed certificates.
- `allow_invalid_cert` (boolean) Disable certificate checks for your local HTTPS server (ignore cert/key/ca options).

Refer to [tls.createSecureContext](https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options) for details on the certificate options.

### Tunnel

The `tunnel` instance returned to your callback emits the following events

| event   | args | description                                                                          |
| ------- | ---- | ------------------------------------------------------------------------------------ |
| request | info | fires when a request is processed by the tunnel, contains _method_ and _path_ fields |
| error   | err  | fires when an error happens on the tunnel                                            |
| close   |      | fires when the tunnel has closed                                                     |

The `tunnel` instance has the following methods

| method | args | description      |
| ------ | ---- | ---------------- |
| close  |      | close the tunnel |

## Changes from Original

This fork includes code/library updates, [test refactoring](docs/TESTING.md), protocol compliance improvements, [request/response inspection](docs/DEBUG_INSPECTION.md) and enhanced error handling:

### Error Handling

**Original behavior:**
- All errors triggered infinite retry attempts

**Current behavior:**
- **4xx errors (Client Errors)**: No retry, returns error immediately
  - Examples: 403 Forbidden (invalid subdomain), 409 Conflict (reserved subdomain)
- **5xx errors (Server Errors)**: Retry up to 3 times with 1s interval
  - After 3 failed retries, returns error with count
- **Network errors**: Infinite retry (maintains original behavior)
  - Examples: ECONNREFUSED, ETIMEDOUT

This prevents unnecessary retry loops for client mistakes while maintaining resilience for temporary server issues.

### Protocol Specification

Includes `client.spec.reference.js` - a comprehensive test specification (v1.0.0, protocol 0.0.8-epc) that defines expected client behavior for:
- Tunnel creation and management
- TCP connection handling
- HTTP request forwarding
- Error scenarios and retry logic

This specification can be used by alternative client implementations to ensure compatibility.

## Documentation

- **[DEBUG_INSPECTION.md](docs/DEBUG_INSPECTION.md)** - Guide for HTTP request/response inspection
- **[TESTING.md](docs/TESTING.md)** - Testing guide and protocol specifications
- **[SCRIPTS.md](docs/SCRIPTS.md)** - Demo scripts documentation
- **[CHANGELOG.md](CHANGELOG.md)** - Version history and changes

## Other clients

Clients in other languages

_go_ [gotunnelme](https://github.com/NoahShen/gotunnelme)

_go_ [go-localtunnel](https://github.com/localtunnel/go-localtunnel)

_C#/.NET_ [localtunnel-client](https://github.com/angelobreuer/localtunnel.net)

_Rust_ [rlt](https://github.com/kaichaosun/rlt)

## Server

See [localtunnel/server](//github.com/localtunnel/server) for details on the original server that powers localtunnel.

See [ericchaves/localtunnel-server](//github.com/ericchaves/localtunnel-server) for details on our updated localtunnel server.

## License

MIT
