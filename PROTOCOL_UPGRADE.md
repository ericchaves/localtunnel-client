# LocalTunnel Client - Protocol Upgrade to 0.0.10-epc

## Overview

This document describes the protocol upgrades implemented to bring the LocalTunnel client from protocol version **0.0.8-epc** to **0.0.10-epc**.

## Protocol Versions

- **Previous**: 0.0.8-epc (base functionality)
- **Current**: 0.0.10-epc (with Client Token and HMAC authentication)

## New Features

### 1. Client Token Authentication (Protocol 0.0.9-epc)

Client Token authentication allows clients to identify themselves with a persistent token instead of relying solely on IP-based identification.

#### Benefits
- Reconnect with same subdomain from different IP addresses
- Persistent client identification across network changes
- Priority over IP-based identification when server supports it

#### Usage

**CLI:**
```bash
lt --port 3000 --subdomain myapp --client-token my-secure-token-123
```

**Programmatic:**
```javascript
import localtunnel from 'localtunnel';

const tunnel = await localtunnel({
  port: 3000,
  subdomain: 'myapp',
  clientToken: 'my-secure-token-123'
});
```

#### Token Requirements
- **Format**: Alphanumeric characters, hyphens, and underscores only (`[a-zA-Z0-9_-]+`)
- **Max Length**: 256 characters
- **Optional**: Fully backward compatible - clients without tokens continue to work
- **Header**: `X-LT-Client-Token: <token>`

#### Validation
The client validates token format locally before sending requests:
- Must be a string
- Cannot exceed 256 characters
- Only alphanumeric, hyphens, and underscores allowed

### 2. HMAC-SHA256 Authentication (Protocol 0.0.10-epc)

HMAC authentication provides cryptographic request authentication for enhanced security.

#### Benefits
- Cryptographic authentication of requests
- Protection against replay attacks (via nonce)
- Server-side validation of client authenticity
- Secure communication without exposing secret

#### Usage

**CLI:**
```bash
lt --port 3000 --subdomain myapp --hmac-secret "my-very-secure-shared-secret-at-least-32-characters"
```

**Programmatic:**
```javascript
import localtunnel from 'localtunnel';

const tunnel = await localtunnel({
  port: 3000,
  subdomain: 'myapp',
  hmacSecret: 'my-very-secure-shared-secret-at-least-32-characters'
});
```

#### HMAC Requirements
- **Algorithm**: HMAC-SHA256
- **Secret Length**: Minimum 32 characters for security
- **Optional**: Fully backward compatible - only used when configured
- **Headers Sent**:
  - `Authorization: HMAC sha256=<hex_signature>`
  - `X-Timestamp: <unix_seconds>`
  - `X-Nonce: <unix_milliseconds>`

#### Message Format
```
METHOD + PATH + TIMESTAMP + NONCE + BODY
```

For example, a GET request to `/myapp`:
```
GET/myapp1735401600173540160000000
```

Where:
- `METHOD` = "GET"
- `PATH` = "/myapp"
- `TIMESTAMP` = "1735401600" (Unix seconds)
- `NONCE` = "1735401600000" (Unix milliseconds)
- `BODY` = "" (empty for GET requests)

#### Validation
The client validates HMAC secret locally:
- Must be a string
- Minimum 32 characters for security

#### Security Features
- **Timestamp**: Unix seconds, allows server to reject old requests
- **Nonce**: Unix milliseconds, prevents replay attacks
- **Signature**: HMAC-SHA256 hex digest ensures request integrity

### 3. Combined Authentication

You can use both Client Token and HMAC authentication together for maximum security:

**CLI:**
```bash
lt --port 3000 \
   --subdomain myapp \
   --client-token my-token-123 \
   --hmac-secret "my-very-secure-shared-secret-at-least-32-characters"
```

**Programmatic:**
```javascript
const tunnel = await localtunnel({
  port: 3000,
  subdomain: 'myapp',
  clientToken: 'my-token-123',
  hmacSecret: 'my-very-secure-shared-secret-at-least-32-characters'
});
```

## Implementation Details

### Files Modified

#### 1. `lib/Tunnel.js`
- Added `crypto` module import for HMAC calculation
- Added `_validateClientToken()` method for token validation
- Added `_validateHmacSecret()` method for secret validation
- Added `_calculateHmacSignature()` method for HMAC-SHA256 signature
- Modified `_init()` to inject authentication headers

#### 2. `bin/lt.js`
- Added `--client-token` CLI option
- Added `--hmac-secret` CLI option
- Updated options passed to `localtunnel()` function

### New Test Suite

Created `authentication.spec.js` with 13 comprehensive tests covering:
- Client Token validation and header injection
- HMAC signature calculation and header injection
- Combined authentication
- Backward compatibility (works without authentication)
- Input validation and error handling

## Backward Compatibility

Both features are **fully backward compatible**:
- Clients without tokens/HMAC continue to work with IP-based identification
- Servers without authentication support ignore the headers
- No breaking changes to existing functionality
- All 28 original tests still pass

## Test Results

```
✓ 41 tests passing
  - 28 original functionality tests
  - 13 new authentication tests
  - 0 failures
```

## Server Requirements

For these features to work, the server must support:
- Protocol version 0.0.9-epc or later for Client Token
- Protocol version 0.0.10-epc or later for HMAC authentication

If the server doesn't support these features, it will ignore the headers and fall back to IP-based identification.

## Security Recommendations

### Client Token
- Use unique, random tokens for each client
- Store tokens securely (environment variables, secure storage)
- Rotate tokens periodically
- Don't commit tokens to version control

### HMAC Secret
- **Minimum 32 characters** (enforced by client)
- Use cryptographically random secrets
- Never expose in logs or error messages
- Share securely between client and server
- Rotate secrets periodically
- Don't commit secrets to version control

### Example Secure Usage

```bash
# Use environment variables
export LT_CLIENT_TOKEN="$(openssl rand -base64 32 | tr -d /=+ | cut -c1-32)"
export LT_HMAC_SECRET="$(openssl rand -base64 48)"

lt --port 3000 \
   --subdomain myapp \
   --client-token "$LT_CLIENT_TOKEN" \
   --hmac-secret "$LT_HMAC_SECRET"
```

## Protocol Specification Reference

For full protocol specification details, see:
- `client.spec.reference.js` - Complete protocol specification
- Lines 82-100: Protocol constants and requirements
- Lines 1422-1544: Client Token tests
- Lines 1551-1733: HMAC authentication tests

## Version History

### 1.2.0 (2025-10-28) - Current
- ✅ Implemented HMAC-SHA256 authentication (Protocol 0.0.10-epc)
- ✅ Required headers: Authorization, X-Timestamp, X-Nonce
- ✅ Numeric nonce for replay attack prevention
- ✅ Comprehensive test coverage

### 1.1.0 (2025-10-28)
- ✅ Implemented Client Token authentication (Protocol 0.0.9-epc)
- ✅ X-LT-Client-Token header support
- ✅ Token format validation
- ✅ Backward compatible

### 1.0.0 (Base)
- Base functionality (Protocol 0.0.8-epc)
- Tunnel creation, TCP management, HTTP forwarding
- WebSocket support, error handling

## Migration Guide

### From 0.0.8-epc to 0.0.10-epc

No migration needed! The upgrade is transparent:
1. Update your client code (already done)
2. Optionally add `clientToken` for persistent identification
3. Optionally add `hmacSecret` for cryptographic authentication
4. All existing code continues to work without changes

### Adding Client Token to Existing Setup

```diff
  const tunnel = await localtunnel({
    port: 3000,
-   subdomain: 'myapp'
+   subdomain: 'myapp',
+   clientToken: process.env.LT_CLIENT_TOKEN
  });
```

### Adding HMAC to Existing Setup

```diff
  const tunnel = await localtunnel({
    port: 3000,
    subdomain: 'myapp',
-   clientToken: process.env.LT_CLIENT_TOKEN
+   clientToken: process.env.LT_CLIENT_TOKEN,
+   hmacSecret: process.env.LT_HMAC_SECRET
  });
```

## Troubleshooting

### "clientToken must contain only alphanumeric characters..."
- Token contains invalid characters
- Only `a-z`, `A-Z`, `0-9`, `-`, and `_` are allowed

### "clientToken must not exceed 256 characters"
- Token is too long
- Maximum length is 256 characters

### "hmacSecret must be at least 32 characters long for security"
- Secret is too short
- Minimum required length is 32 characters

### "clientToken must be a string" / "hmacSecret must be a string"
- Value is not a string type
- Make sure you're passing a string, not a number or object

## Support

For issues or questions:
1. Check the test suite: `authentication.spec.js`
2. Review the specification: `client.spec.reference.js`
3. Verify server protocol version compatibility
4. Check debug logs with `DEBUG=localtunnel:* lt ...`
