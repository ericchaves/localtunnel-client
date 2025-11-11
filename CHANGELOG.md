# 2.2.0-epc (2025-11-11)

## Protocol 0.0.11-epc Support - Local Service Reconnection

This release upgrades the LocalTunnel client from protocol version 0.0.10-epc to 0.0.11-epc.

### New Features

#### Local Service Reconnection Control
- **Intelligent retry** when local service connection closes, without disrupting tunnel to server
- **CLI Options**: `--local-reconnect` (boolean), `--local-retry-max` (number)
- **Environment Variables**: `LT_LOCAL_RECONNECT`, `LT_LOCAL_RETRY_MAX`
- **API**: `local_reconnect` and `local_retry_max` options in `localtunnel()` function
- **Default behavior**: Infinite retries enabled (backward compatible)
- **Benefits**: Keeps tunnel stable during local service restarts, configurable fail-fast behavior

### Changed
- **Improved Connection Management**: Local connection failures no longer force remote reconnection
  - Keeps tunnel to server stable during local service restarts
  - Reduces unnecessary TCP handshakes and HMAC authentications
  - Prevents connection storms to tunnel server
- **Graceful shutdown**: Client exits with code 0 when all connections fail with reconnection disabled

### Usage Examples

```bash
# Default: Infinite retries (backward compatible)
lt --port 3000

# Limit to 5 retry attempts
lt --port 3000 --local-retry-max 5

# Disable reconnection (fail fast)
lt --port 3000 --no-local-reconnect

# Via environment variables
LT_LOCAL_RETRY_MAX=10 LT_PORT=3000 lt
```

### Technical Details
- Local connection retry uses 1-second delay between attempts
- Remote tunnel connection remains stable during local retries
- Temporary listeners detect server disconnection during retry
- Proper cleanup prevents memory leaks and listener accumulation
- Compatible with all authentication methods (Client Token, HMAC)

---

# 2.1.0-epc (2025-10-28)

## Protocol 0.0.10-epc Support - Authentication Features

This release upgrades the LocalTunnel client from protocol version 0.0.8-epc to 0.0.10-epc.

### New Features

#### Client Token Authentication (Protocol 0.0.9-epc)
- **Client Token authentication** for persistent client identification
- **CLI Option**: `--client-token <token>`
- **Environment Variable**: `LT_CLIENT_TOKEN`
- **API**: `clientToken` option in `localtunnel()` function
- **Benefits**: Reconnect with same subdomain from different IPs, persistent identification
- **Header**: `X-LT-Client-Token: <token>`

#### HMAC-SHA256 Authentication (Protocol 0.0.10-epc)
- **Cryptographic request authentication** using HMAC-SHA256
- **CLI Option**: `--hmac-secret <secret>` (min 32 characters)
- **Environment Variable**: `LT_HMAC_SECRET`
- **API**: `hmacSecret` option in `localtunnel()` function
- **Benefits**: Cryptographic authentication, replay attack protection
- **Headers**: `Authorization`, `X-Timestamp`, `X-Nonce`

#### Environment Variables
- All CLI options now support environment variables with `LT_` prefix
- Example: `export LT_CLIENT_TOKEN="token"` and `export LT_HMAC_SECRET="secret"`

### Usage Examples

```bash
# With Client Token
lt --port 3000 --subdomain myapp --client-token my-token-123

# With HMAC
lt --port 3000 --subdomain myapp --hmac-secret "32-char-minimum-secret"

# Using environment variables
export LT_CLIENT_TOKEN="my-token"
export LT_HMAC_SECRET="32-char-minimum-secret"
lt --port 3000 --subdomain myapp

# Programmatic
const tunnel = await localtunnel({
  port: 3000,
  clientToken: 'my-token',
  hmacSecret: '32-char-minimum-secret'
});
```

### Documentation
- Added `PROTOCOL_UPGRADE.md` - Complete protocol upgrade guide
- Added `authentication.spec.js` - 13 new tests (41 total, all passing)
- Added `examples/authentication-example.js` - Practical examples
- Added `.env.example` - Environment variables configuration template

### Compatibility
- **100% backward compatible** - existing code works without changes
- Both features are optional
- Falls back to IP-based identification when not configured
- All 28 original tests still passing

### Modified Files
- `lib/Tunnel.js` - Added authentication logic and validation
- `bin/lt.js` - Added CLI options and environment variable support

# 2.0.2 (2021-09-18)

- Upgrade dependencies

# 2.0.1 (2021-01-09)

- Upgrade dependencies

# 2.0.0 (2019-09-16)

- Add support for tunneling a local HTTPS server
- Add support for localtunnel server with IP-based tunnel URLs
- Node.js client API is now Promise-based, with backwards compatibility to callback
- Major refactor of entire codebase using modern ES syntax (requires Node.js v8.3.0 or above)

# 1.9.2 (2019-06-01)

- Update debug to 4.1.1
- Update axios to 0.19.0

# 1.9.1 (2018-09-08)

- Update debug to 2.6.9

# 1.9.0 (2018-04-03)

- Add _request_ event to Tunnel emitter
- Update yargs to support config via environment variables
- Add basic request logging when --print-requests argument is used

# 1.8.3 (2017-06-11)

- update request dependency
- update debug dependency
- update openurl dependency

# 1.8.2 (2016-11-17)

- fix host header transform
- update request dependency

# 1.8.1 (2016-01-20)

- fix bug w/ HostHeaderTransformer and binary data

# 1.8.0 (2015-11-04)

- pass socket errors up to top level

# 1.7.0 (2015-07-22)

- add short arg options

# 1.6.0 (2015-05-15)

- keep sockets alive after connecting
- add --open param to CLI

# 1.5.0 (2014-10-25)

- capture all errors on remote socket and restart the tunnel

# 1.4.0 (2014-08-31)

- don't emit errors for ETIMEDOUT

# 1.2.0 / 2014-04-28

- return `client` from `localtunnel` API instantiation

# 1.1.0 / 2014-02-24

- add a host header transform to change the 'Host' header in requests

# 1.0.0 / 2014-02-14

- default to localltunnel.me for host
- remove exported `connect` method (just export one function that does the same thing)
- change localtunnel signature to (port, opt, fn)

# 0.2.2 / 2014-01-09
