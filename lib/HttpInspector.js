import debugLib from 'debug';

const debug = debugLib('localtunnel:inspector');

/**
 * Utility class for inspecting and formatting HTTP requests/responses
 */
class HttpInspector {
  constructor() {
    // Get preview size from environment variable or use default
    this.previewSize = parseInt(process.env.INSPECT_BODY_PREVIEW_SIZE || '500', 10);
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
   * Format body for logging based on content type
   * @param {Buffer} data - Raw HTTP data
   * @param {number} headerEndIndex - Index where headers end
   * @param {string} category - Content category ('json', 'xml', 'text', 'binary')
   * @returns {string} - Formatted body string
   */
  formatBody(data, headerEndIndex, category) {
    const bodySize = this.calculateBodySize(data, headerEndIndex);

    if (bodySize === 0) {
      return '[empty body]';
    }

    const bodyBuffer = data.slice(headerEndIndex);

    switch (category) {
      case 'json':
        try {
          const bodyStr = bodyBuffer.toString('utf8');
          const parsed = JSON.parse(bodyStr);
          return JSON.stringify(parsed, null, 2);
        } catch (e) {
          debug('Failed to parse JSON body:', e.message);
          return `[invalid JSON - ${bodySize} bytes]\n${bodyBuffer.toString('utf8', 0, Math.min(bodySize, this.previewSize))}`;
        }

      case 'xml':
      case 'text':
        const preview = bodyBuffer.toString('utf8', 0, Math.min(bodySize, this.previewSize));
        if (bodySize > this.previewSize) {
          return `${preview}\n... [truncated, total: ${bodySize} bytes]`;
        }
        return preview;

      case 'binary':
      default:
        return `[binary content - ${bodySize} bytes]`;
    }
  }

  /**
   * Format HTTP request for logging
   * @param {Buffer} data - Raw HTTP request data
   * @returns {string} - Formatted request string
   */
  formatRequest(data) {
    const parsed = this.parseHeaders(data);

    if (!parsed) {
      return `[incomplete request - ${data.length} bytes received so far]`;
    }

    const contentType = parsed.headers['content-type'];
    const contentLength = parsed.headers['content-length'];
    const category = this.detectContentCategory(contentType);
    const actualBodySize = this.calculateBodySize(data, parsed.headerEndIndex);

    let output = `\n${'='.repeat(80)}\n`;
    output += `REQUEST: ${parsed.firstLine}\n`;
    output += `${'='.repeat(80)}\n`;
    output += `HEADERS:\n`;

    for (const [name, value] of Object.entries(parsed.headers)) {
      output += `  ${name}: ${value}\n`;
    }

    output += `\nBODY INFO:\n`;
    output += `  Content-Type: ${contentType || 'not specified'}\n`;
    output += `  Content-Length (header): ${contentLength || 'not specified'}\n`;
    output += `  Actual Body Size: ${actualBodySize} bytes\n`;
    output += `  Category: ${category}\n`;

    if (actualBodySize > 0) {
      output += `\nBODY:\n`;
      output += this.formatBody(data, parsed.headerEndIndex, category);
      output += '\n';
    }

    output += `${'='.repeat(80)}\n`;

    return output;
  }

  /**
   * Format HTTP response for logging
   * @param {Buffer} data - Raw HTTP response data
   * @returns {string} - Formatted response string
   */
  formatResponse(data) {
    const parsed = this.parseHeaders(data);

    if (!parsed) {
      return `[incomplete response - ${data.length} bytes received so far]`;
    }

    const contentType = parsed.headers['content-type'];
    const contentLength = parsed.headers['content-length'];
    const category = this.detectContentCategory(contentType);
    const actualBodySize = this.calculateBodySize(data, parsed.headerEndIndex);

    let output = `\n${'='.repeat(80)}\n`;
    output += `RESPONSE: ${parsed.firstLine}\n`;
    output += `${'='.repeat(80)}\n`;
    output += `HEADERS:\n`;

    for (const [name, value] of Object.entries(parsed.headers)) {
      output += `  ${name}: ${value}\n`;
    }

    output += `\nBODY INFO:\n`;
    output += `  Content-Type: ${contentType || 'not specified'}\n`;
    output += `  Content-Length (header): ${contentLength || 'not specified'}\n`;
    output += `  Actual Body Size: ${actualBodySize} bytes\n`;
    output += `  Category: ${category}\n`;

    if (actualBodySize > 0) {
      output += `\nBODY:\n`;
      output += this.formatBody(data, parsed.headerEndIndex, category);
      output += '\n';
    }

    output += `${'='.repeat(80)}\n`;

    return output;
  }
}

export default HttpInspector;
