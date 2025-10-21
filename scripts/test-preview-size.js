#!/usr/bin/env node

import HttpInspector from '../lib/HttpInspector.js';

// Test with custom preview size
process.env.INSPECT_BODY_PREVIEW_SIZE = '50';

const inspector = new HttpInspector();

console.log(`Preview size set to: ${inspector.previewSize} bytes\n`);

// Large text response
const largeText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10);
const textResponse = Buffer.from(
  'HTTP/1.1 200 OK\r\n' +
  'Content-Type: text/plain\r\n' +
  `Content-Length: ${largeText.length}\r\n` +
  '\r\n' +
  largeText
);

console.log(inspector.formatResponse(textResponse));

// Test with XML
console.log('\n\nNow testing with XML:');
const largeXml = '<?xml version="1.0"?><root><item>data</item></root>'.repeat(5);
const xmlResponse = Buffer.from(
  'HTTP/1.1 200 OK\r\n' +
  'Content-Type: application/xml\r\n' +
  `Content-Length: ${largeXml.length}\r\n` +
  '\r\n' +
  largeXml
);

console.log(inspector.formatResponse(xmlResponse));
