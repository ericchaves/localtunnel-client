#!/usr/bin/env node

/**
 * Simple test script to demonstrate the HTTP inspection functionality
 *
 * Usage:
 * DEBUG=localtunnel:inspect:* node scripts/test-debug.js
 *
 * Or to see only requests:
 * DEBUG=localtunnel:inspect:request node scripts/test-debug.js
 *
 * Or to see only responses:
 * DEBUG=localtunnel:inspect:response node scripts/test-debug.js
 *
 * To control the preview size for text/xml bodies:
 * LT_INSPECT_BODY_PREVIEW_SIZE=1000 DEBUG=localtunnel:inspect:* node scripts/test-debug.js
 */

import HttpInspector from '../lib/HttpInspector.js';

const inspector = new HttpInspector();

console.log('Testing HttpInspector with different content types\n');
console.log('='.repeat(80));

// Test 1: JSON Request
console.log('\n1. JSON Request:');
const jsonRequest = Buffer.from(
  'POST /api/users HTTP/1.1\r\n' +
  'Host: example.com\r\n' +
  'Content-Type: application/json\r\n' +
  'Content-Length: 45\r\n' +
  '\r\n' +
  '{"name":"John Doe","email":"john@example.com"}'
);
console.log(inspector.formatRequest(jsonRequest));

// Test 2: XML Response
console.log('\n2. XML Response:');
const xmlResponse = Buffer.from(
  'HTTP/1.1 200 OK\r\n' +
  'Content-Type: application/xml\r\n' +
  'Content-Length: 150\r\n' +
  '\r\n' +
  '<?xml version="1.0"?><response><status>success</status><message>Operation completed</message></response>'
);
console.log(inspector.formatResponse(xmlResponse));

// Test 3: Text Response
console.log('\n3. Text Response:');
const textResponse = Buffer.from(
  'HTTP/1.1 200 OK\r\n' +
  'Content-Type: text/plain\r\n' +
  'Content-Length: 50\r\n' +
  '\r\n' +
  'This is a plain text response with some content.'
);
console.log(inspector.formatResponse(textResponse));

// Test 4: Binary Response (image)
console.log('\n4. Binary Response:');
const binaryResponse = Buffer.from(
  'HTTP/1.1 200 OK\r\n' +
  'Content-Type: image/png\r\n' +
  'Content-Length: 1024\r\n' +
  '\r\n'
);
// Add some fake binary data
const binaryData = Buffer.concat([
  binaryResponse,
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) // PNG header
]);
console.log(inspector.formatResponse(binaryData));

// Test 5: Large JSON (to show complete formatting)
console.log('\n5. Large JSON Response:');
const largeJson = {
  users: [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
    { id: 3, name: 'Charlie', email: 'charlie@example.com' }
  ],
  metadata: {
    total: 3,
    page: 1,
    per_page: 10
  }
};
const largeJsonStr = JSON.stringify(largeJson);
const largeJsonResponse = Buffer.from(
  'HTTP/1.1 200 OK\r\n' +
  'Content-Type: application/json\r\n' +
  `Content-Length: ${largeJsonStr.length}\r\n` +
  '\r\n' +
  largeJsonStr
);
console.log(inspector.formatResponse(largeJsonResponse));

// Test 6: Request with no body
console.log('\n6. GET Request (no body):');
const getRequest = Buffer.from(
  'GET /api/users?page=1 HTTP/1.1\r\n' +
  'Host: api.example.com\r\n' +
  'Accept: application/json\r\n' +
  'User-Agent: curl/7.68.0\r\n' +
  '\r\n'
);
console.log(inspector.formatRequest(getRequest));

console.log('\n' + '='.repeat(80));
console.log('Test completed!\n');
console.log('To see this in action with actual tunnels, run:');
console.log('DEBUG=localtunnel:inspect:* node bin/lt.js --port 3000');
