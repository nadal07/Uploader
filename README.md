# Cloudflare Tunnel Large File Uploader & Streamer

A resilient, resumable chunked upload and byte-range streaming solution designed specifically for self-hosted applications running behind **Cloudflare Tunnel**.

Bypass Cloudflare's **100MB/300MB HTTP payload limits** to upload multi-gigabyte files (videos, ISOs, archives) effortlessly and stream videos via **HTTP 206 Partial Content (Byte Range Requests)** without buffering.

---

## ⚡ The Problem Solved

When self-hosting an application and exposing it via Cloudflare Tunnel:
1. **Upload Size Restriction**: Cloudflare limits individual HTTP request payloads to **100MB** on Free/Pro plans (and up to 300MB on Business/Enterprise). Direct file uploads exceeding this limit fail with `413 Payload Too Large`.
2. **Video Streaming Timeouts**: Monolithic downloads of large video files can trigger Cloudflare buffer timeouts and memory pressure on the client.

### How This Solution Solves It
- **Client-Side Slicing**: Files are sliced in the browser into **10MB chunks** (customizable from 5MB to 50MB). Each chunk is an independent HTTP request comfortably below Cloudflare's limit.
- **Resumable & Fault Tolerant**: Chunk states are tracked on both client (`localStorage`) and server. Network drops or browser refreshes automatically resume from the last verified chunk.
- **Byte-Range Video Streaming (HTTP 206)**: Serves video files with `Range: bytes=start-end` support, enabling HTML5 players to seek forward/backward instantly without loading the full video.

---

## 🚀 Key Features

- **Any File Size**: Upload 1GB, 5GB, 10GB+ files over Cloudflare Tunnel without hitting payload errors.
- **Live Chunk Matrix Visualizer**: Real-time dashboard showing every chunk's state (`Done`, `Uploading`, `Pending`, `Retry`).
- **Instant Video Playback**: Built-in video player with live HTTP 206 Byte-Range debugging.
- **Modular SDK**:
  - `UploaderClient`: Standalone browser JS library for any web frontend (React, Vue, Vanilla JS).
  - `createUploaderRouter`: Express router/middleware ready to mount in any Node.js application.
- **Docker & Compose Ready**: Production-grade Docker container with volume persistence and health checks.

---

## 📁 Repository Structure

```
├── Dockerfile                  # Production Node.js 20 Alpine container
├── docker-compose.yml          # Docker Compose with volume persistence
├── .dockerignore               # Docker build exclusions
├── .gitignore                  # Git ignore rules (node_modules, uploads)
├── server.js                   # Main application server entry point
├── package.json                # Project dependencies and test scripts
├── lib/
│   ├── uploader-client.js      # Browser JS SDK for chunking, retry & resume
│   └── uploader-server.js      # Express router for chunk merging & HTTP 206 streaming
├── public/
│   ├── index.html              # Dashboard UI with live chunk matrix & player modal
│   ├── style.css               # Modern dark theme styles
│   └── app.js                  # Frontend controller
└── scripts/
    └── test-uploader.js        # Automated verification test suite
```

---

## 🐳 Quick Start (Docker)

### Using Docker Compose
```bash
# Start container with persistent uploads volume
docker compose up -d --build

# View logs
docker compose logs -f
```

Open `http://localhost:3000` in your browser.

### Using Docker CLI
```bash
docker build -t cloudflare-uploader .
docker run -d \
  --name cloudflare_uploader \
  -p 3000:3000 \
  -v $(pwd)/uploads:/app/uploads \
  --restart unless-stopped \
  cloudflare-uploader
```

---

## 💻 Local Development (Node.js)

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation & Running
```bash
# Install dependencies
npm install

# Run automated verification tests
npm test

# Start the server
npm start

# For development with auto-reload
npm run dev
```

---

## 🌐 Exposing via Cloudflare Tunnel

### Method 1: Quick Tunnel (Development)
```bash
cloudflared tunnel --url http://localhost:3000
```
This generates a temporary public URL (e.g. `https://random-name.trycloudflare.com`).

### Method 2: Cloudflare Zero Trust (Production Named Tunnel)
1. In the **Cloudflare Zero Trust Dashboard**, go to **Networks** -> **Tunnels**.
2. Create or select your tunnel.
3. Under **Public Hostname**, configure:
   - **Service**: `HTTP`
   - **URL**: `localhost:3000` (or `uploader:3000` within Docker network)
   - **Hostname**: `uploader.yourdomain.com`

---

## 🔌 Integrating into Existing Apps

### Express / Node.js Backend
```javascript
const express = require('express');
const { createUploaderRouter } = require('./lib/uploader-server');

const app = express();

// Mount uploader API
app.use('/api', createUploaderRouter({
  storageDir: './uploads',
}));

app.listen(3000);
```

### Frontend Web App
```html
<script src="/lib/uploader-client.js"></script>
<script>
  const uploader = new UploaderClient({
    apiBaseUrl: '/api',
    chunkSize: 10 * 1024 * 1024, // 10MB chunk size
    concurrency: 2
  });

  uploader
    .on('progress', (data) => {
      console.log(`Progress: ${data.percent}% | Speed: ${data.speedBytesPerSec} B/s`);
    })
    .on('complete', (result) => {
      console.log('File available at:', result.fileRecord.streamUrl);
    });

  // Start upload on file select
  fileInputElement.addEventListener('change', (e) => {
    uploader.start(e.target.files[0]);
  });
</script>
```

---

## 📡 API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/init` | `POST` | Initializes upload session or recovers existing chunks. |
| `/api/chunk` | `POST` | Uploads an individual binary chunk (`x-upload-id`, `x-chunk-index`). |
| `/api/status/:uploadId` | `GET` | Returns list of received chunks for session recovery. |
| `/api/complete` | `POST` | Assembles chunks sequentially into the final target file. |
| `/api/files` | `GET` | Lists all completed files on the server. |
| `/api/stream/:fileId` | `GET` | Streams file using **HTTP 206 Partial Content** byte-range requests. |
| `/api/download/:fileId`| `GET` | Downloads the file as an attachment. |
| `/api/files/:fileId` | `DELETE` | Deletes file from storage and index. |
| `/api/info` | `GET` | Service status and configuration info. |

---

## 🧪 Testing

Run the automated test suite to verify chunk reassembly, SHA-256 bit-for-bit integrity, and HTTP 206 Range streaming:
```bash
npm test
```

---

## 📄 License
MIT
