import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import zlib from 'zlib';
import { createRequire } from 'module';
import debugLib from 'debug';

const require = createRequire(import.meta.url);
const Snowflake = require('snowflake-id').default;

const debug = debugLib('localtunnel:inspector');

/**
 * Utility class for inspecting and dumping HTTP requests/responses
 */
class HttpInspector {
  constructor(dumpDir = null) {
    this.dumpDir = dumpDir;

    // Initialize Snowflake ID generator if dumping is enabled
    if (this.dumpDir) {
      this.snowflake = new Snowflake({
        custom_epoch: 1609459200000, // 2021-01-01 00:00:00 UTC
        instance_id: 1
      });
      this.ensureDumpDir();
    }
  }

  /**
   * Ensure dump directory exists
   */
  ensureDumpDir() {
    if (this.dumpDir && !fs.existsSync(this.dumpDir)) {
      fs.mkdirSync(this.dumpDir, { recursive: true });
      debug(`Created dump directory: ${this.dumpDir} (recursive=true)`);
    }
  }

  /**
   * Parse HTTP headers from raw data
   * @param {Buffer} data - Raw HTTP data
   * @returns {Object|null} - Parsed headers or null if incomplete
   */
  parseHeaders(data) {
    const str = data.toString('utf8');
    const headerEndIndex = str.indexOf('\r\n\r\n');

    if (headerEndIndex === -1) {
      return null; // Headers incomplete
    }

    const headerSection = str.substring(0, headerEndIndex);
    const lines = headerSection.split('\r\n');

    // First line is either request line or status line
    const firstLine = lines[0];
    const headers = {};

    for (let i = 1; i < lines.length; i++) {
      const colonIndex = lines[i].indexOf(':');
      if (colonIndex > 0) {
        const name = lines[i].substring(0, colonIndex).trim().toLowerCase();
        const value = lines[i].substring(colonIndex + 1).trim();
        headers[name] = value;
      }
    }

    return {
      firstLine,
      headers,
      headerEndIndex: headerEndIndex + 4, // Include the \r\n\r\n
      rawHeaders: headerSection
    };
  }

  /**
   * Parse request line (e.g., "GET /path HTTP/1.1")
   * @param {string} firstLine - First line of HTTP request
   * @returns {Object} - Parsed request line
   */
  parseRequestLine(firstLine) {
    const parts = firstLine.split(' ');
    if (parts.length >= 3) {
      return {
        method: parts[0],
        path: parts[1],
        httpVersion: parts[2]
      };
    }
    return {
      method: 'UNKNOWN',
      path: '/',
      httpVersion: 'HTTP/1.1'
    };
  }

  /**
   * Parse response status line (e.g., "HTTP/1.1 200 OK")
   * @param {string} firstLine - First line of HTTP response
   * @returns {Object} - Parsed status line
   */
  parseStatusLine(firstLine) {
    const parts = firstLine.split(' ');
    if (parts.length >= 2) {
      return {
        httpVersion: parts[0],
        statusCode: parseInt(parts[1], 10) || 0,
        statusMessage: parts.slice(2).join(' ') || ''
      };
    }
    return {
      httpVersion: 'HTTP/1.1',
      statusCode: 0,
      statusMessage: ''
    };
  }

  /**
   * Detect content type category
   * @param {string} contentType - Content-Type header value
   * @returns {string} - 'json', 'xml', 'text', or 'binary'
   */
  detectContentCategory(contentType) {
    if (!contentType) {
      return 'text'; // Default to text if no content-type
    }

    const ct = contentType.toLowerCase();

    // JSON detection
    if (ct.includes('application/json') || ct.match(/application\/[^+]+\+json/)) {
      return 'json';
    }

    // XML detection
    if (ct.includes('application/xml') ||
        ct.includes('text/xml') ||
        ct.match(/application\/[^+]+\+xml/)) {
      return 'xml';
    }

    // Text detection
    if (ct.startsWith('text/')) {
      return 'text';
    }

    // Everything else is binary
    return 'binary';
  }

  /**
   * Calculate actual body size from data
   * @param {Buffer} data - Raw HTTP data
   * @param {number} headerEndIndex - Index where headers end
   * @returns {number} - Body size in bytes
   */
  calculateBodySize(data, headerEndIndex) {
    return data.length - headerEndIndex;
  }

  /**
   * Convert headers object to array format for YAML
   * @param {Object} headers - Headers object
   * @returns {Object} - Headers in array format
   */
  convertHeadersToArrayFormat(headers) {
    const result = {};
    for (const [name, value] of Object.entries(headers)) {
      // Store each header as an array of values
      result[name] = [value];
    }
    return result;
  }

  /**
   * Decode chunked transfer encoding
   * @param {Buffer} buffer - Buffer with chunked data
   * @returns {Buffer} - Decoded body
   */
  decodeChunkedBody(buffer) {
    const chunks = [];
    let offset = 0;
    let chunkCount = 0;

    debug('decodeChunkedBody: Starting to decode %d bytes', buffer.length);

    while (offset < buffer.length) {
      // Find chunk size line (hex number followed by \r\n)
      const crlfIndex = buffer.indexOf('\r\n', offset);
      if (crlfIndex === -1) {
        debug('decodeChunkedBody: No CRLF found at offset %d, stopping', offset);
        break;
      }

      const chunkSizeLine = buffer.toString('utf8', offset, crlfIndex).trim();
      debug('decodeChunkedBody: Chunk #%d size line: "%s"', chunkCount, chunkSizeLine);

      // Handle chunk extensions (e.g., "1a3f;name=value" -> "1a3f")
      const semicolonIndex = chunkSizeLine.indexOf(';');
      const chunkSizeHex = semicolonIndex !== -1
        ? chunkSizeLine.substring(0, semicolonIndex).trim()
        : chunkSizeLine;

      const chunkSize = parseInt(chunkSizeHex, 16);

      if (isNaN(chunkSize)) {
        debug('decodeChunkedBody: Invalid chunk size "%s", stopping', chunkSizeHex);
        break;
      }

      debug('decodeChunkedBody: Chunk #%d size: %d bytes (0x%s)', chunkCount, chunkSize, chunkSizeHex);

      if (chunkSize === 0) {
        debug('decodeChunkedBody: Found final chunk (size 0), stopping');
        break; // Last chunk
      }

      // Extract chunk data
      const chunkStart = crlfIndex + 2;
      const chunkEnd = chunkStart + chunkSize;

      if (chunkEnd > buffer.length) {
        debug('decodeChunkedBody: Chunk extends beyond buffer (end: %d, buffer: %d), stopping',
              chunkEnd, buffer.length);
        break;
      }

      const chunkData = buffer.slice(chunkStart, chunkEnd);
      chunks.push(chunkData);
      debug('decodeChunkedBody: Extracted chunk #%d: %d bytes', chunkCount, chunkData.length);

      // Move to next chunk (skip trailing \r\n)
      offset = chunkEnd + 2;
      chunkCount++;

      // Safety check: verify we have the trailing \r\n
      if (offset > buffer.length) {
        debug('decodeChunkedBody: Offset beyond buffer after chunk, stopping');
        break;
      }
    }

    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    debug('decodeChunkedBody: Decoded %d chunks, total size: %d bytes', chunkCount, totalSize);

    return chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
  }

  /**
   * Decompress body based on content-encoding
   * @param {Buffer} buffer - Compressed body
   * @param {string} encoding - Content encoding (gzip, deflate, br)
   * @returns {Buffer} - Decompressed body
   */
  decompressBody(buffer, encoding) {
    try {
      if (encoding === 'gzip') {
        return zlib.gunzipSync(buffer);
      } else if (encoding === 'deflate') {
        return zlib.inflateSync(buffer);
      } else if (encoding === 'br') {
        return zlib.brotliDecompressSync(buffer);
      }
    } catch (e) {
      debug('Failed to decompress body: %s', e.message);
    }
    return buffer;
  }

  /**
   * Check if content type is binary
   * @param {string} contentType - Content-Type header value
   * @returns {boolean} - True if binary content
   */
  isBinaryContent(contentType) {
    if (!contentType) return false;

    const textTypes = [
      'text/',
      'application/json',
      'application/xml',
      'application/javascript',
      'application/x-www-form-urlencoded',
      'image/svg+xml',
    ];

    const binaryTypes = [
      'image/',
      'video/',
      'audio/',
      'application/octet-stream',
      'application/pdf',
      'application/zip',
      'font/',
    ];

    // Check text types first (more specific)
    if (textTypes.some(t => contentType.includes(t))) {
      return false;
    }

    // Check binary types
    return binaryTypes.some(t => contentType.includes(t));
  }

  /**
   * Get file extension from Content-Type
   * @param {string} contentType - Content-Type header value
   * @returns {string} - File extension (e.g., 'png', 'pdf', 'bin')
   */
  getFileExtension(contentType) {
    if (!contentType) return 'bin';

    const ct = contentType.toLowerCase().split(';')[0].trim();

    const extensionMap = {
      // Images
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
      'image/x-icon': 'ico',
      'image/vnd.microsoft.icon': 'ico',

      // Documents
      'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',

      // Archives
      'application/zip': 'zip',
      'application/x-zip-compressed': 'zip',
      'application/gzip': 'gz',
      'application/x-gzip': 'gz',
      'application/x-tar': 'tar',
      'application/x-7z-compressed': '7z',
      'application/x-rar-compressed': 'rar',

      // Video
      'video/mp4': 'mp4',
      'video/mpeg': 'mpeg',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'video/x-msvideo': 'avi',

      // Audio
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/aac': 'aac',

      // Fonts
      'font/woff': 'woff',
      'font/woff2': 'woff2',
      'font/ttf': 'ttf',
      'font/otf': 'otf',
      'application/font-woff': 'woff',
      'application/font-woff2': 'woff2',
      'application/x-font-ttf': 'ttf',
      'application/x-font-otf': 'otf',

      // Other
      'application/octet-stream': 'bin',
    };

    return extensionMap[ct] || 'bin';
  }

  /**
   * Get body content for dumping, handling binary data
   * @param {Buffer} data - Raw HTTP data
   * @param {number} headerEndIndex - Index where headers end
   * @param {string} category - Content category
   * @param {Object} headers - Parsed headers
   * @param {string} clientId - Client ID for filename
   * @param {string} snowflakeId - Snowflake ID for filename
   * @returns {string} - Body content or reference to external file
   */
  getBodyContent(data, headerEndIndex, category, headers, clientId, snowflakeId) {
    let bodyBuffer = data.slice(headerEndIndex); // headerEndIndex already includes \r\n\r\n

    if (bodyBuffer.length === 0) {
      return '';
    }

    // Step 1: Decode chunked transfer encoding if present
    const transferEncoding = headers['transfer-encoding'];
    if (transferEncoding && transferEncoding.includes('chunked')) {
      bodyBuffer = this.decodeChunkedBody(bodyBuffer);
      debug('Decoded chunked transfer encoding: %d bytes', bodyBuffer.length);
    }

    // Step 2: Decompress content encoding if present
    const contentEncoding = headers['content-encoding'];
    if (contentEncoding) {
      bodyBuffer = this.decompressBody(bodyBuffer, contentEncoding);
      debug('Decompressed %s encoding: %d bytes', contentEncoding, bodyBuffer.length);
    }

    // Step 3: Check if content is binary and save to external file
    const contentType = headers['content-type'];
    if (this.isBinaryContent(contentType)) {
      const extension = this.getFileExtension(contentType);
      const filename = `${clientId}.${snowflakeId}.res.${extension}`;
      const filepath = path.join(this.dumpDir, filename);
      fs.writeFileSync(filepath, bodyBuffer);
      debug('Saved binary content to: %s (%d bytes, type: %s)', filename, bodyBuffer.length, contentType);
      return `{{file.contents(${filename})}}`;
    }

    // Step 4: Handle text-based content
    switch (category) {
      case 'json':
        try {
          const bodyStr = bodyBuffer.toString('utf8');
          const parsed = JSON.parse(bodyStr);
          // Return pretty-printed JSON
          return JSON.stringify(parsed, null, 2);
        } catch (e) {
          const bodyStr = bodyBuffer.toString('utf8');
          debug(
            'Failed to parse JSON body: %s (body preview: %s...)',
            e.message,
            bodyStr.substring(0, 100)
          );
          return bodyStr;
        }

      case 'xml':
      case 'text':
      default:
        return bodyBuffer.toString('utf8');
    }
  }

  /**
   * Dump HTTP request to YAML file
   * @param {Buffer} data - Raw HTTP request data
   * @param {string} clientId - Client ID (tunnel subdomain)
   * @returns {string|null} - Snowflake ID used for filename, or null if failed
   */
  dumpRequest(data, clientId) {
    if (!this.dumpDir) {
      debug('Dump directory not configured, skipping request dump');
      return null;
    }

    try {
      const parsed = this.parseHeaders(data);

      if (!parsed) {
        debug('Cannot dump incomplete request (received %d bytes, missing complete headers)', data.length);
        return null;
      }

      const requestLine = this.parseRequestLine(parsed.firstLine);
      const contentType = parsed.headers['content-type'];
      const category = this.detectContentCategory(contentType);

      // Generate unique ID
      const snowflakeId = this.snowflake.generate();

      const bodyContent = this.getBodyContent(
        data,
        parsed.headerEndIndex,
        category,
        parsed.headers,
        clientId,
        snowflakeId.toString()
      );

      // Build YAML structure
      const yamlData = {
        request: {
          host: parsed.headers['host'] || 'unknown',
          method: requestLine.method,
          path: requestLine.path,
          headers: this.convertHeadersToArrayFormat(parsed.headers),
          body: bodyContent
        }
      };

      // Write to file
      const filename = `${clientId}.${snowflakeId}.req.yaml`;
      const filepath = path.join(this.dumpDir, filename);
      const yamlContent = yaml.dump(yamlData, {
        indent: 2,
        lineWidth: -1, // No line wrapping
        noRefs: true
      });

      fs.writeFileSync(filepath, yamlContent, 'utf8');
      const stats = fs.statSync(filepath);
      debug(`Request dumped to: ${filename} (${stats.size} bytes, path: ${this.dumpDir})`);

      return snowflakeId;
    } catch (error) {
      debug('Error dumping request: %s [code=%s, dumpDir=%s]', error.message, error.code || 'UNKNOWN', this.dumpDir);
      return null;
    }
  }

  /**
   * Dump HTTP response to YAML file
   * @param {Buffer} data - Raw HTTP response data
   * @param {string} clientId - Client ID (tunnel subdomain)
   * @param {string} snowflakeId - Snowflake ID to use for pairing with request
   * @returns {boolean} - Success status
   */
  dumpResponse(data, clientId, snowflakeId) {
    if (!this.dumpDir) {
      debug('Dump directory not configured, skipping response dump');
      return false;
    }

    try {
      const parsed = this.parseHeaders(data);

      if (!parsed) {
        debug('Cannot dump incomplete response (received %d bytes, missing complete headers)', data.length);
        return false;
      }

      const statusLine = this.parseStatusLine(parsed.firstLine);
      const contentType = parsed.headers['content-type'];
      const category = this.detectContentCategory(contentType);
      const bodyContent = this.getBodyContent(
        data,
        parsed.headerEndIndex,
        category,
        parsed.headers,
        clientId,
        snowflakeId
      );

      // Build YAML structure
      const yamlData = {
        response: {
          statusCode: statusLine.statusCode,
          headers: this.convertHeadersToArrayFormat(parsed.headers),
          body: bodyContent
        }
      };

      // Write to file
      const filename = `${clientId}.${snowflakeId}.res.yaml`;
      const filepath = path.join(this.dumpDir, filename);
      const yamlContent = yaml.dump(yamlData, {
        indent: 2,
        lineWidth: -1, // No line wrapping
        noRefs: true
      });

      fs.writeFileSync(filepath, yamlContent, 'utf8');
      const stats = fs.statSync(filepath);
      debug(`Response dumped to: ${filename} (${stats.size} bytes, path: ${this.dumpDir})`);

      return true;
    } catch (error) {
      debug('Error dumping response: %s [code=%s, dumpDir=%s]', error.message, error.code || 'UNKNOWN', this.dumpDir);
      return false;
    }
  }
}

export default HttpInspector;
