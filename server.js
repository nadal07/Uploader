const express = require('express');
const path = require('path');
const cors = require('cors');
const { createUploaderRouter } = require('./lib/uploader-server');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for external access / Cloudflare Tunnel
app.use(cors());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/lib', express.static(path.join(__dirname, 'lib')));

// Mount uploader API router
const uploaderRouter = createUploaderRouter({
  storageDir: path.join(__dirname, 'uploads'),
  tempDir: path.join(__dirname, 'uploads', 'temp'),
});
app.use('/api', uploaderRouter);

// System info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Cloudflare Tunnel Uploader & Streamer',
    version: '1.0.0',
    status: 'online',
    defaultChunkSizeMB: 10,
    cloudflareTunnelOptimized: true,
  });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Uploader Server running on http://localhost:${PORT}`);
  console.log(`📡 Cloudflare Tunnel Chunked Upload & Byte-Range Ready`);
  console.log(`=======================================================`);
});
