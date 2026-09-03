const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');

/**
 * Creates an Express router configured for chunked resumable uploads and byte-range streaming.
 * @param {Object} options Configuration options
 * @param {string} [options.storageDir='./uploads'] Directory where completed files are stored
 * @param {string} [options.tempDir='./uploads/temp'] Directory where temporary chunk files are stored
 * @returns {import('express').Router} Express Router
 */
function createUploaderRouter(options = {}) {
  const express = require('express');
  const router = express.Router();

  const storageDir = path.resolve(options.storageDir || './uploads');
  const tempDir = path.resolve(options.tempDir || path.join(storageDir, 'temp'));
  const dbFile = path.join(storageDir, 'files_index.json');

  // Ensure directories exist
  if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // Database helper (simple file-based index for self-hosting)
  function getFileDb() {
    if (!fs.existsSync(dbFile)) return {};
    try {
      return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    } catch {
      return {};
    }
  }

  function saveFileDb(data) {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
  }

  // Parse raw body for binary chunk uploads
  router.use('/chunk', express.raw({ limit: '100mb', type: '*/*' }));
  router.use(express.json());

  /**
   * POST /init
   * Initialize or recover an upload session
   */
  router.post('/init', (req, res) => {
    try {
      const { filename, filesize, chunksize, filehash } = req.body;

      if (!filename || !filesize || !chunksize) {
        return res.status(400).json({ error: 'filename, filesize, and chunksize are required' });
      }

      // Generate a deterministic or random uploadId
      const hashInput = `${filename}_${filesize}_${filehash || ''}`;
      const uploadId = crypto.createHash('md5').update(hashInput).digest('hex');

      const sessionDir = path.join(tempDir, uploadId);
      const metadataPath = path.join(sessionDir, 'metadata.json');

      const totalChunks = Math.ceil(filesize / chunksize);

      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      let existingChunks = [];
      if (fs.existsSync(metadataPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          existingChunks = meta.uploadedChunks || [];
        } catch (e) {
          existingChunks = [];
        }
      }

      // Verify existing chunks on disk
      existingChunks = existingChunks.filter((chunkIndex) => {
        const chunkPath = path.join(sessionDir, `chunk_${chunkIndex}`);
        return fs.existsSync(chunkPath);
      });

      const metadata = {
        uploadId,
        filename,
        filesize: Number(filesize),
        chunksize: Number(chunksize),
        totalChunks,
        filehash: filehash || null,
        uploadedChunks: existingChunks,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      return res.json({
        uploadId,
        filename,
        filesize: metadata.filesize,
        chunksize: metadata.chunksize,
        totalChunks,
        uploadedChunks: existingChunks,
        isComplete: existingChunks.length === totalChunks,
      });
    } catch (err) {
      console.error('Error initializing upload:', err);
      return res.status(500).json({ error: 'Internal server error initializing upload' });
    }
  });

  /**
   * GET /status/:uploadId
   * Check status of an upload session
   */
  router.get('/status/:uploadId', (req, res) => {
    const { uploadId } = req.params;
    const sessionDir = path.join(tempDir, uploadId);
    const metadataPath = path.join(sessionDir, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      return res.json(metadata);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read upload session metadata' });
    }
  });

  /**
   * POST /chunk
   * Upload an individual file chunk (Binary payload)
   * Headers: x-upload-id, x-chunk-index
   */
  router.post('/chunk', (req, res) => {
    try {
      const uploadId = req.headers['x-upload-id'] || req.query.uploadId;
      const chunkIndex = parseInt(req.headers['x-chunk-index'] || req.query.chunkIndex, 10);

      if (!uploadId || isNaN(chunkIndex)) {
        return res.status(400).json({ error: 'Missing x-upload-id or x-chunk-index headers' });
      }

      const sessionDir = path.join(tempDir, uploadId);
      const metadataPath = path.join(sessionDir, 'metadata.json');

      if (!fs.existsSync(metadataPath)) {
        return res.status(404).json({ error: 'Upload session not found' });
      }

      const chunkPath = path.join(sessionDir, `chunk_${chunkIndex}`);
      
      // Save chunk binary data to disk
      const chunkData = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      fs.writeFileSync(chunkPath, chunkData);

      // Update metadata
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (!metadata.uploadedChunks.includes(chunkIndex)) {
        metadata.uploadedChunks.push(chunkIndex);
        metadata.uploadedChunks.sort((a, b) => a - b);
      }
      metadata.updatedAt = Date.now();
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      return res.json({
        success: true,
        uploadId,
        chunkIndex,
        receivedBytes: chunkData.length,
        uploadedChunksCount: metadata.uploadedChunks.length,
        totalChunks: metadata.totalChunks,
      });
    } catch (err) {
      console.error('Error saving chunk:', err);
      return res.status(500).json({ error: 'Failed to save chunk' });
    }
  });

  /**
   * POST /complete
   * Assemble all uploaded chunks into the final target file
   */
  router.post('/complete', async (req, res) => {
    try {
      const { uploadId } = req.body;
      if (!uploadId) {
        return res.status(400).json({ error: 'uploadId is required' });
      }

      const sessionDir = path.join(tempDir, uploadId);
      const metadataPath = path.join(sessionDir, 'metadata.json');

      if (!fs.existsSync(metadataPath)) {
        return res.status(404).json({ error: 'Upload session not found' });
      }

      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      const { filename, totalChunks, filesize } = metadata;

      // Ensure all chunks are present
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(sessionDir, `chunk_${i}`);
        if (!fs.existsSync(chunkPath)) {
          return res.status(400).json({
            error: `Missing chunk ${i} of ${totalChunks}. Upload incomplete.`,
          });
        }
      }

      const fileId = crypto.randomBytes(8).toString('hex');
      const sanitizedFilename = path.basename(filename).replace(/[^a-zA-Z0-9.-_]/g, '_');
      const finalFileName = `${fileId}_${sanitizedFilename}`;
      const finalFilePath = path.join(storageDir, finalFileName);

      const writeStream = fs.createWriteStream(finalFilePath);

      // Sequentially stream chunks into final file
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(sessionDir, `chunk_${i}`);
        const chunkBuffer = fs.readFileSync(chunkPath);
        writeStream.write(chunkBuffer);
      }

      await new Promise((resolve, reject) => {
        writeStream.end();
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // Cleanup temp chunk files
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn('Could not clean temp folder:', cleanupErr.message);
      }

      // Record in file DB
      const mimeType = mime.lookup(filename) || 'application/octet-stream';
      const fileStats = fs.statSync(finalFilePath);

      const fileRecord = {
        fileId,
        originalName: filename,
        storedName: finalFileName,
        size: fileStats.size,
        mimeType,
        uploadedAt: new Date().toISOString(),
        streamUrl: `/api/stream/${fileId}`,
        downloadUrl: `/api/download/${fileId}`,
      };

      const db = getFileDb();
      db[fileId] = fileRecord;
      saveFileDb(db);

      return res.json({
        success: true,
        message: 'File upload completed and merged successfully!',
        file: fileRecord,
      });
    } catch (err) {
      console.error('Error completing file upload:', err);
      return res.status(500).json({ error: 'Failed to assemble file chunks' });
    }
  });

  /**
   * GET /files
   * List all uploaded files
   */
  router.get('/files', (req, res) => {
    const db = getFileDb();
    const fileList = Object.values(db).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    return res.json(fileList);
  });

  /**
   * DELETE /files/:fileId
   * Delete an uploaded file
   */
  router.delete('/files/:fileId', (req, res) => {
    const { fileId } = req.params;
    const db = getFileDb();
    const fileRecord = db[fileId];

    if (!fileRecord) {
      return res.status(404).json({ error: 'File not found' });
    }

    const filePath = path.join(storageDir, fileRecord.storedName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    delete db[fileId];
    saveFileDb(db);

    return res.json({ success: true, message: 'File deleted successfully' });
  });

  /**
   * GET /stream/:fileId or GET /download/:fileId
   * HTTP 206 Byte Range Request Video Streaming & File Download
   */
  const handleStreamOrDownload = (req, res, isDownload = false) => {
    const { fileId } = req.params;
    const db = getFileDb();
    const fileRecord = db[fileId];

    if (!fileRecord) {
      return res.status(404).send('File not found');
    }

    const filePath = path.join(storageDir, fileRecord.storedName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File missing on disk');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="${fileRecord.originalName}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${fileRecord.originalName}"`);
    }

    res.setHeader('Accept-Ranges', 'bytes');

    // Handle Byte Range Requests (HTTP 206) for smooth seeking & media streaming
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.status(416).send('Requested Range Not Satisfiable');
      }

      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': fileRecord.mimeType,
        'Cache-Control': 'public, max-age=3600',
      });

      fileStream.pipe(res);
    } else {
      // Full content response (HTTP 200)
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': fileRecord.mimeType,
        'Cache-Control': 'public, max-age=3600',
      });

      fs.createReadStream(filePath).pipe(res);
    }
  };

  router.get('/stream/:fileId', (req, res) => handleStreamOrDownload(req, res, false));
  router.get('/download/:fileId', (req, res) => handleStreamOrDownload(req, res, true));

  return router;
}

module.exports = { createUploaderRouter };
