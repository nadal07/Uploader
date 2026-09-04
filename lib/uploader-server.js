const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const {
  AuthService,
  signToken,
  verifyToken,
  verifyPassword,
} = require('./auth-service');

/**
 * Creates an Express router configured for authenticated, chunked resumable uploads,
 * folder-based permission control, and byte-range streaming.
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

  // Initialize AuthService
  const authService = new AuthService(storageDir);

  // Ensure directories exist
  if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // Database helper for files
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

  // --- Authentication Middlewares ---
  function authenticate(req, res, next) {
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Missing token.' });
    }

    const payload = verifyToken(token);
    if (!payload || !payload.userId) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    const user = authService.getUserById(payload.userId);
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists.' });
    }

    const { passwordHash, ...safeUser } = user;
    req.user = safeUser;
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden. Admin privileges required.' });
    }
    next();
  }

  // Parse raw body for binary chunk uploads
  router.use('/chunk', express.raw({ limit: '100mb', type: '*/*' }));
  router.use(express.json());

  // ==========================================
  // AUTHENTICATION ROUTES
  // ==========================================

  /**
   * POST /auth/login
   * Authenticate user and return JWT token
   */
  router.post('/auth/login', (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      const user = authService.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const isValid = verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const token = signToken({
        userId: user.id,
        username: user.username,
        role: user.role,
      });

      const { passwordHash, ...safeUser } = user;
      const accessibleFolders = authService.getUserAccessibleFolders(safeUser);

      return res.json({
        token,
        user: safeUser,
        accessibleFolders,
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Internal server error during login' });
    }
  });

  /**
   * GET /auth/me
   * Retrieve current user profile and accessible folders
   */
  router.get('/auth/me', authenticate, (req, res) => {
    const accessibleFolders = authService.getUserAccessibleFolders(req.user);
    return res.json({
      user: req.user,
      accessibleFolders,
    });
  });

  /**
   * PUT /auth/password
   * Update own password
   */
  router.put('/auth/password', authenticate, (req, res) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
      }
      authService.updateUser(req.user.id, { password: newPassword });
      return res.json({ success: true, message: 'Password updated successfully' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // FOLDER ROUTES
  // ==========================================

  /**
   * GET /folders
   * List folders accessible to current user
   */
  router.get('/folders', authenticate, (req, res) => {
    const folders = authService.getUserAccessibleFolders(req.user);
    return res.json(folders);
  });

  /**
   * POST /folders
   * Create a new folder (Admin only)
   */
  router.post('/folders', authenticate, requireAdmin, (req, res) => {
    try {
      const { name, description } = req.body;
      const folder = authService.createFolder({
        name,
        description,
        createdBy: req.user.username,
      });
      return res.status(201).json({ success: true, folder });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  /**
   * DELETE /folders/:folderId
   * Delete a folder (Admin only)
   */
  router.delete('/folders/:folderId', authenticate, requireAdmin, (req, res) => {
    try {
      const { folderId } = req.params;
      authService.deleteFolder(folderId);
      return res.json({ success: true, message: 'Folder deleted successfully' });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // ==========================================
  // ADMIN USER MANAGEMENT ROUTES
  // ==========================================

  /**
   * GET /admin/users
   * List all users (Admin only)
   */
  router.get('/admin/users', authenticate, requireAdmin, (req, res) => {
    const users = authService.getAllUsers();
    return res.json(users);
  });

  /**
   * POST /admin/users
   * Create a new user with folder access (Admin only)
   */
  router.post('/admin/users', authenticate, requireAdmin, (req, res) => {
    try {
      const { username, password, role, allowedFolderIds } = req.body;
      const newUser = authService.createUser({
        username,
        password,
        role: role || 'user',
        allowedFolderIds: Array.isArray(allowedFolderIds) ? allowedFolderIds : [],
      });
      return res.status(201).json({ success: true, user: newUser });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  /**
   * PUT /admin/users/:userId
   * Update user role, folder permissions, or password (Admin only)
   */
  router.put('/admin/users/:userId', authenticate, requireAdmin, (req, res) => {
    try {
      const { userId } = req.params;
      const { role, allowedFolderIds, password } = req.body;
      const updated = authService.updateUser(userId, { role, allowedFolderIds, password });
      return res.json({ success: true, user: updated });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  /**
   * DELETE /admin/users/:userId
   * Delete a user (Admin only)
   */
  router.delete('/admin/users/:userId', authenticate, requireAdmin, (req, res) => {
    try {
      const { userId } = req.params;
      authService.deleteUser(userId);
      return res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // ==========================================
  // CHUNKED UPLOAD ROUTES (WITH AUTH & FOLDER)
  // ==========================================

  /**
   * POST /init
   * Initialize or recover an upload session for a specific target folder
   */
  router.post('/init', authenticate, (req, res) => {
    try {
      const { filename, filesize, chunksize, filehash, folderId } = req.body;

      if (!filename || !filesize || !chunksize || !folderId) {
        return res
          .status(400)
          .json({ error: 'filename, filesize, chunksize, and folderId are required' });
      }

      // Check folder exists
      const folder = authService.getFolderById(folderId);
      if (!folder) {
        return res.status(404).json({ error: 'Target folder does not exist' });
      }

      // Verify user has permission to upload to this folder
      if (!authService.canUserAccessFolder(req.user, folderId)) {
        return res
          .status(403)
          .json({ error: `You do not have permission to upload to folder "${folder.name}"` });
      }

      // Generate uploadId
      const hashInput = `${folderId}_${filename}_${filesize}_${filehash || ''}`;
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
        } catch {
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
        folderId: folder.id,
        folderName: folder.name,
        folderPath: folder.folderPath,
        uploadedBy: {
          id: req.user.id,
          username: req.user.username,
        },
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
        folderId: folder.id,
        folderName: folder.name,
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
  router.get('/status/:uploadId', authenticate, (req, res) => {
    const { uploadId } = req.params;
    const sessionDir = path.join(tempDir, uploadId);
    const metadataPath = path.join(sessionDir, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      // Verify user permission
      if (!authService.canUserAccessFolder(req.user, metadata.folderId)) {
        return res.status(403).json({ error: 'Access denied to this upload session' });
      }
      return res.json(metadata);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read upload session metadata' });
    }
  });

  /**
   * POST /chunk
   * Upload an individual file chunk (Binary payload)
   */
  router.post('/chunk', authenticate, (req, res) => {
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

      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (!authService.canUserAccessFolder(req.user, metadata.folderId)) {
        return res.status(403).json({ error: 'Permission denied to upload to this folder' });
      }

      const chunkPath = path.join(sessionDir, `chunk_${chunkIndex}`);
      const chunkData = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      fs.writeFileSync(chunkPath, chunkData);

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
   * Assemble all uploaded chunks into the target folder
   */
  router.post('/complete', authenticate, async (req, res) => {
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
      const { filename, totalChunks, folderId, folderPath, folderName, uploadedBy } = metadata;

      // Verify permission
      if (!authService.canUserAccessFolder(req.user, folderId)) {
        return res.status(403).json({ error: 'Permission denied' });
      }

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

      // Destination directory corresponds to the target folder
      const targetFolderDir = path.join(storageDir, folderPath || 'general');
      if (!fs.existsSync(targetFolderDir)) {
        fs.mkdirSync(targetFolderDir, { recursive: true });
      }

      const finalFilePath = path.join(targetFolderDir, finalFileName);
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
        folderId,
        folderName,
        folderPath,
        size: fileStats.size,
        mimeType,
        uploadedAt: new Date().toISOString(),
        uploadedBy: uploadedBy || { id: req.user.id, username: req.user.username },
        streamUrl: `/api/stream/${fileId}`,
        downloadUrl: `/api/download/${fileId}`,
      };

      const db = getFileDb();
      db[fileId] = fileRecord;
      saveFileDb(db);

      return res.json({
        success: true,
        message: 'File upload completed and merged into target folder successfully!',
        file: fileRecord,
      });
    } catch (err) {
      console.error('Error completing file upload:', err);
      return res.status(500).json({ error: 'Failed to assemble file chunks' });
    }
  });

  /**
   * GET /files
   * List files filtered by user's accessible folders
   */
  router.get('/files', authenticate, (req, res) => {
    const db = getFileDb();
    const allFiles = Object.values(db).sort(
      (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)
    );

    // Filter files: admin sees all; user sees only files in allowed folders
    const allowedFiles = allFiles.filter((f) =>
      authService.canUserAccessFolder(req.user, f.folderId)
    );

    return res.json(allowedFiles);
  });

  /**
   * DELETE /files/:fileId
   * Delete an uploaded file (Admin or owner in allowed folder)
   */
  router.delete('/files/:fileId', authenticate, (req, res) => {
    const { fileId } = req.params;
    const db = getFileDb();
    const fileRecord = db[fileId];

    if (!fileRecord) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Permission check: Admin or the user who uploaded it
    const isOwner = fileRecord.uploadedBy && fileRecord.uploadedBy.id === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'Permission denied. You can only delete your own files.' });
    }

    const folderPath = fileRecord.folderPath || 'general';
    const filePath = path.join(storageDir, folderPath, fileRecord.storedName);

    // Fallback if stored in root storageDir
    const fallbackPath = path.join(storageDir, fileRecord.storedName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    } else if (fs.existsSync(fallbackPath)) {
      fs.unlinkSync(fallbackPath);
    }

    delete db[fileId];
    saveFileDb(db);

    return res.json({ success: true, message: 'File deleted successfully' });
  });

  /**
   * GET /stream/:fileId or GET /download/:fileId
   * Authenticated HTTP 206 Byte Range Request Video Streaming & File Download
   * Supports authentication via Bearer header OR ?token= query parameter
   */
  const handleStreamOrDownload = (req, res, isDownload = false) => {
    const { fileId } = req.params;
    const db = getFileDb();
    const fileRecord = db[fileId];

    if (!fileRecord) {
      return res.status(404).send('File not found');
    }

    // Check user permission for this folder
    if (!authService.canUserAccessFolder(req.user, fileRecord.folderId)) {
      return res.status(403).send('Forbidden: Access denied to this folder');
    }

    const folderPath = fileRecord.folderPath || 'general';
    let filePath = path.join(storageDir, folderPath, fileRecord.storedName);

    // Fallback to root if not in folder directory
    if (!fs.existsSync(filePath)) {
      filePath = path.join(storageDir, fileRecord.storedName);
    }

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

  router.get('/stream/:fileId', authenticate, (req, res) => handleStreamOrDownload(req, res, false));
  router.get('/download/:fileId', authenticate, (req, res) => handleStreamOrDownload(req, res, true));

  return router;
}

module.exports = { createUploaderRouter };
