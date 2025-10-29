#!/usr/bin/env python3
"""
Simple HTTP server for testing binary content with localtunnel.

Usage:
    python3 test-binary-server.py

This will start a server on port 8000 serving:
- /image.png - A test PNG image
- /document.pdf - A test PDF document
- /video.mp4 - A test MP4 video
- /archive.zip - A test ZIP archive
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import io

class BinaryTestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/image.png':
            # Create a minimal valid PNG (1x1 pixel red image)
            png_data = bytes([
                0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
                0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1 dimensions
                0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
                0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,  # IDAT chunk
                0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
                0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D,
                0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,  # IEND chunk
                0x44, 0xAE, 0x42, 0x60, 0x82
            ])
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(png_data)))
            self.end_headers()
            self.wfile.write(png_data)

        elif self.path == '/image.jpg':
            # Create a minimal valid JPEG (1x1 pixel)
            jpeg_data = bytes([
                0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,  # JPEG header
                0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
                0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
                0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
                0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C,
                0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
                0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D,
                0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20,
                0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
                0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27,
                0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34,
                0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
                0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4,
                0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x03, 0xFF, 0xC4, 0x00, 0x14,
                0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
                0x00, 0x00, 0x3F, 0x00, 0x3F, 0x00, 0xFF, 0xD9
            ])
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', str(len(jpeg_data)))
            self.end_headers()
            self.wfile.write(jpeg_data)

        elif self.path == '/document.pdf':
            # Create a minimal valid PDF
            pdf_data = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
185
%%EOF"""
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Length', str(len(pdf_data)))
            self.end_headers()
            self.wfile.write(pdf_data)

        elif self.path == '/archive.zip':
            # Create a minimal valid ZIP (empty archive)
            zip_data = bytes([
                0x50, 0x4B, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,  # End of central directory
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00
            ])
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Length', str(len(zip_data)))
            self.end_headers()
            self.wfile.write(zip_data)

        elif self.path == '/':
            # Index page
            html = b"""<!DOCTYPE html>
<html>
<head><title>Binary Test Server</title></head>
<body>
    <h1>Binary Content Test Server</h1>
    <p>Test the following binary endpoints:</p>
    <ul>
        <li><a href="/image.png">PNG Image</a> (image/png)</li>
        <li><a href="/image.jpg">JPEG Image</a> (image/jpeg)</li>
        <li><a href="/document.pdf">PDF Document</a> (application/pdf)</li>
        <li><a href="/archive.zip">ZIP Archive</a> (application/zip)</li>
    </ul>
    <p>Each endpoint will return a minimal valid binary file of that type.</p>
</body>
</html>"""
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(html)))
            self.end_headers()
            self.wfile.write(html)

        else:
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'404 Not Found')

    def log_message(self, format, *args):
        # Custom log format
        print(f"[{self.log_date_time_string()}] {format % args}")

if __name__ == '__main__':
    port = 8000
    server = HTTPServer(('localhost', port), BinaryTestHandler)
    print(f"Binary test server running on http://localhost:{port}")
    print(f"Available endpoints:")
    print(f"  http://localhost:{port}/         - Index page")
    print(f"  http://localhost:{port}/image.png - PNG image")
    print(f"  http://localhost:{port}/image.jpg - JPEG image")
    print(f"  http://localhost:{port}/document.pdf - PDF document")
    print(f"  http://localhost:{port}/archive.zip - ZIP archive")
    print(f"\nPress Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()
