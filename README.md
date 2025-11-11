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
- `--client-token` authenticate with a client token for persistent subdomain reservation (Protocol 0.0.9-epc)
- `--hmac-secret` authenticate requests with HMAC-SHA256 (Protocol 0.0.10-epc, min 32 characters)
- `--local-reconnect` enable/disable local connection retry (default: true)
- `--local-retry-max` maximum local connection retry attempts, 0 = infinite (default: 0)

You may also specify arguments via env variables. e.g.

```
PORT=3000 lt
```

### Authentication (Optional)

LocalTunnel client now supports two optional authentication methods (Protocol 0.0.10-epc):

#### Client Token Authentication
Use a persistent token to identify your client and reserve your subdomain across different IP addresses.

```bash
lt --port 3000 --subdomain myapp --client-token my-secure-token-123
```

**Benefits:**
- Reconnect with the same subdomain from different IP addresses
- Persistent client identification across network changes
- Priority over IP-based identification on supported servers

**Requirements:**
- Format: Alphanumeric characters, hyphens, and underscores only `[a-zA-Z0-9_-]+`
- Maximum length: 256 characters

#### HMAC-SHA256 Authentication
Cryptographically authenticate your tunnel creation requests using a shared secret.

```bash
lt --port 3000 --subdomain myapp --hmac-secret "my-very-secure-shared-secret-32-chars"
```

**Benefits:**
- Cryptographic authentication of requests
- Protection against replay attacks using nonce
- Server-side validation of request authenticity

**Requirements:**
- Minimum length: 32 characters (enforced for security)

#### Combined Authentication
Use both methods together for maximum security:

```bash
lt --port 3000 --subdomain myapp \
   --client-token my-token-123 \
   --hmac-secret "my-very-secure-shared-secret-32-chars"
```

#### Using Environment Variables (Recommended)
Store your authentication credentials securely using environment variables:

```bash
export LT_CLIENT_TOKEN="my-secure-token-123"
export LT_HMAC_SECRET="my-very-secure-shared-secret-32-chars"
lt --port 3000 --subdomain myapp
```

**Using .env file:**
```bash
# Copy the example file
cp .env.example .env

# Edit .env with your settings
# Then run localtunnel (it will automatically load .env variables)
lt

# Or run the dotenv example script
node examples/dotenv-usage.js
```

See [.env.example](.env.example) for a complete configuration template with all available options, and [examples/dotenv-usage.js](examples/dotenv-usage.js) for a working example.

**Note:** Both authentication methods are optional and backward compatible. Clients without authentication will continue to work using IP-based identification.

### Environment Variables

All CLI options can be set via environment variables with `LT_` prefix (e.g., `LT_PORT`, `LT_CLIENT_TOKEN`):

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `LT_PORT` | Internal HTTP server port | - | `LT_PORT=3000` |
| `LT_HOST` | Upstream server providing forwarding | `https://localtunnel.me` | `LT_HOST=https://custom.server.com` |
| `LT_SUBDOMAIN` | Request a specific subdomain | random | `LT_SUBDOMAIN=myapp` |
| `LT_LOCAL_HOST` | Tunnel traffic to this host instead of localhost | `localhost` | `LT_LOCAL_HOST=192.168.1.100` |
| `LT_LOCAL_HTTPS` | Tunnel traffic to a local HTTPS server | `false` | `LT_LOCAL_HTTPS=true` |
| `LT_LOCAL_CERT` | Path to certificate PEM file for local HTTPS | - | `LT_LOCAL_CERT=/path/to/cert.pem` |
| `LT_LOCAL_KEY` | Path to certificate key file for local HTTPS | - | `LT_LOCAL_KEY=/path/to/key.pem` |
| `LT_LOCAL_CA` | Path to certificate authority file | - | `LT_LOCAL_CA=/path/to/ca.pem` |
| `LT_ALLOW_INVALID_CERT` | Disable certificate checks for local HTTPS | `false` | `LT_ALLOW_INVALID_CERT=true` |
| `LT_CLIENT_TOKEN` | **Client token for authentication** (Protocol 0.0.9-epc) | - | `LT_CLIENT_TOKEN=my-token-123` |
| `LT_HMAC_SECRET` | **HMAC secret for request authentication** (Protocol 0.0.10-epc, min 32 chars) | - | `LT_HMAC_SECRET=my-secret` |
| `LT_LOCAL_RECONNECT` | Enable local connection retry | `true` | `LT_LOCAL_RECONNECT=false` |
| `LT_LOCAL_RETRY_MAX` | Maximum local connection retry attempts (0 = infinite) | `0` | `LT_LOCAL_RETRY_MAX=5` |
| `LT_OPEN` | Opens the tunnel URL in your browser | `false` | `LT_OPEN=true` |
| `LT_PRINT_REQUESTS` | Print basic request info | `false` | `LT_PRINT_REQUESTS=true` |

#### Debug Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `DEBUG` | Enable debug output | - | `DEBUG=localtunnel:*` |

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
LT_PORT=3000 LT_SUBDOMAIN=myapp LT_CLIENT_TOKEN=my-token DEBUG=localtunnel:* lt
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
- `clientToken` (string) **[NEW]** Client token for authentication and subdomain reservation (Protocol 0.0.9-epc). Format: alphanumeric, hyphens, and underscores only. Max 256 characters.
- `hmacSecret` (string) **[NEW]** HMAC shared secret for request authentication (Protocol 0.0.10-epc). Minimum 32 characters required.
- `local_reconnect` (boolean) Enable automatic retry when local service connection fails. Default: `true`.
- `local_retry_max` (number) Maximum number of retry attempts for local service connection. Set to `0` for infinite retries. Default: `0`.

Refer to [tls.createSecureContext](https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options) for details on the certificate options.

#### Example with Authentication

```js
const localtunnel = require("localtunnel");

(async () => {
  const tunnel = await localtunnel({
    port: 3000,
    subdomain: 'myapp',
    clientToken: 'my-secure-token-123',
    hmacSecret: 'my-very-secure-shared-secret-32-chars'
  });

  console.log('Tunnel URL:', tunnel.url);

  tunnel.on("close", () => {
    console.log('Tunnel closed');
  });
})();
```

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

This fork includes code/library updates, [test refactoring](docs/TESTING.md), protocol compliance improvements, enhanced error handling, and **authentication features** (Protocol 0.0.10-epc):

### Authentication Features (NEW - Protocol 0.0.10-epc)

Added two optional authentication methods for enhanced security and persistent client identification:

#### Client Token Authentication (Protocol 0.0.9-epc)
- Persistent client identification using tokens
- Reconnect with same subdomain from different IP addresses
- Token validation (alphanumeric, hyphens, underscores, max 256 chars)
- Header: `X-LT-Client-Token`

#### HMAC-SHA256 Authentication (Protocol 0.0.10-epc)
- Cryptographic request authentication
- HMAC-SHA256 signature calculation
- Protection against replay attacks using timestamp and nonce
- Headers: `Authorization`, `X-Timestamp`, `X-Nonce`
- Minimum 32-character secret enforced

Both features are **optional and backward compatible**. See the [Authentication](#authentication-optional) section for usage examples, or the [PROTOCOL_UPGRADE.md](PROTOCOL_UPGRADE.md) guide for complete details.

### Local Service Reconnection (NEW - Protocol 0.0.11-epc)

LocalTunnel now supports intelligent reconnection to your local service when it becomes unavailable, **without** disrupting the tunnel connection to the server.

**How it works:**
- When your local service closes a connection, LocalTunnel automatically retries
- Remote tunnel connection to the server remains stable (no unnecessary reconnection overhead)
- Configurable maximum retry attempts or infinite retries
- Can be completely disabled for strict fail-fast behavior

**Configuration:**

```bash
# Default: Infinite retries (backward compatible)
lt --port 3000

# Limit to 5 retry attempts
lt --port 3000 --local-retry-max 5

# Disable local reconnection (close tunnel when local service fails)
lt --port 3000 --no-local-reconnect

# Via environment variables
LT_LOCAL_RETRY_MAX=10 lt --port 3000
LT_LOCAL_RECONNECT=false lt --port 3000
```

**Behavior:**
- **Reconnection enabled** (default): Keeps trying to reconnect with 1-second intervals
- **Max retries set**: Stops after N failed attempts and closes the tunnel
- **Reconnection disabled**: Immediately closes tunnel when local service closes connection
- **All connections fail**: Client exits gracefully with exit code 0

**Use cases:**
- **Development**: Enable reconnection for server restarts (default behavior)
- **Production**: Set max retries to fail fast if local service is down
- **CI/CD**: Disable reconnection for predictable test behavior

**API usage:**

```js
const tunnel = await localtunnel({
  port: 3000,
  local_reconnect: true,  // Enable retry (default)
  local_retry_max: 5      // Max 5 attempts (0 = infinite, default)
});
```

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

- **[PROTOCOL_UPGRADE.md](PROTOCOL_UPGRADE.md)** - Protocol 0.0.10-epc upgrade guide and authentication features
- **[.env.example](.env.example)** - Environment variables configuration template
- **[TESTING.md](docs/TESTING.md)** - Testing guide and protocol specifications
- **[CHANGELOG.md](CHANGELOG.md)** - Version history and changes
- **[examples/authentication-example.js](examples/authentication-example.js)** - Authentication usage examples
- **[examples/dotenv-usage.js](examples/dotenv-usage.js)** - Using .env file for configuration

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
