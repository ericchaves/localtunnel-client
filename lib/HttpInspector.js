import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
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
      debug(`Created dump directory: ${this.dumpDir}`);
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
   * Get body content for dumping, handling binary data
   * @param {Buffer} data - Raw HTTP data
   * @param {number} headerEndIndex - Index where headers end
   * @param {string} category - Content category
   * @returns {string} - Body content or placeholder for binary
   */
  getBodyContent(data, headerEndIndex, category) {
    const bodySize = this.calculateBodySize(data, headerEndIndex);

    if (bodySize === 0) {
      return '';
    }

    if (category === 'binary') {
      return `[BINARY CONTENT - ${bodySize} bytes - not saved]`;
    }

    const bodyBuffer = data.slice(headerEndIndex);

    switch (category) {
      case 'json':
        try {
          const bodyStr = bodyBuffer.toString('utf8');
          const parsed = JSON.parse(bodyStr);
          // Return pretty-printed JSON
          return JSON.stringify(parsed, null, 2);
        } catch (e) {
          debug('Failed to parse JSON body:', e.message);
          return bodyBuffer.toString('utf8');
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
        debug('Cannot dump incomplete request');
        return null;
      }

      const requestLine = this.parseRequestLine(parsed.firstLine);
      const contentType = parsed.headers['content-type'];
      const category = this.detectContentCategory(contentType);
      const bodyContent = this.getBodyContent(data, parsed.headerEndIndex, category);

      // Generate unique ID
      const snowflakeId = this.snowflake.generate();

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
      debug(`Request dumped to: ${filename}`);

      return snowflakeId;
    } catch (error) {
      debug('Error dumping request:', error.message);
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
        debug('Cannot dump incomplete response');
        return false;
      }

      const statusLine = this.parseStatusLine(parsed.firstLine);
      const contentType = parsed.headers['content-type'];
      const category = this.detectContentCategory(contentType);
      const bodyContent = this.getBodyContent(data, parsed.headerEndIndex, category);

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
      debug(`Response dumped to: ${filename}`);

      return true;
    } catch (error) {
      debug('Error dumping response:', error.message);
      return false;
    }
  }
}

export default HttpInspector;
