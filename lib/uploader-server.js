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
 * actual system folder storage, and byte-range streaming.
 * @param {Object} options Configuration options
 * @param {string} [options.storageDir='./uploads'] Directory where completed files and DB are stored
 * @param {string} [options.tempDir='./uploads/temp'] Directory where temporary chunk files are stored
 * @returns {import('express').Router} Express Router
 */
function createUploaderRouter(options = {}) {
  const express = require('express');
  const router = express.Router();

  const storageDir = path.resolve(options.storageDir || './uploads');
  const tempDir = path.resolve(options.tempDir || path.join(storageDir, 'temp'));
  const dbFile = path.join(storageDir, 'files_index.json');

  // Initialize AuthService (handles auth and actual system folders)
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

  router.get('/auth/me', authenticate, (req, res) => {
    const accessibleFolders = authService.getUserAccessibleFolders(req.user);
    return res.json({
      user: req.user,
      accessibleFolders,
    });
  });

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
  // FOLDER ROUTES (ACTUAL SYSTEM FOLDERS)
  // ==========================================

  router.get('/folders', authenticate, (req, res) => {
    const folders = authService.getUserAccessibleFolders(req.user);
    return res.json(folders);
  });

  /**
   * POST /folders
   * Create a folder mapping to an actual system path (Admin only)
   */
  router.post('/folders', authenticate, requireAdmin, (req, res) => {
    try {
      const { name, systemPath, description } = req.body;
      const folder = authService.createFolder({
        name,
        systemPath,
        description,
        createdBy: req.user.username,
      });
      return res.status(201).json({ success: true, folder });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  /**
   * POST /folders/:folderId/scan
   * Scan actual system folder directory to discover existing files (Admin only)
   */
  router.post('/folders/:folderId/scan', authenticate, requireAdmin, (req, res) => {
    try {
      const { folderId } = req.params;
      const scanResult = authService.scanSystemFolder(folderId, getFileDb, saveFileDb);
      return res.json({
        success: true,
        message: `Scanned system folder successfully. Found ${scanResult.totalFound} items (${scanResult.newlyDiscovered} newly indexed).`,
        ...scanResult,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  /**
   * GET /folders/:folderId/users
   * Get users authorized to access this folder (Admin only)
   */
  router.get('/folders/:folderId/users', authenticate, requireAdmin, (req, res) => {
    try {
      const { folderId } = req.params;
      const users = authService.getFolderAuthorizedUsers(folderId);
      return res.json(users);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  /**
   * PUT /folders/:folderId/users
   * Update users authorized to access this folder (Admin only)
   */
  router.put('/folders/:folderId/users', authenticate, requireAdmin, (req, res) => {
    try {
      const { folderId } = req.params;
      const { userIds } = req.body;
      authService.setFolderUsers(folderId, userIds);
      return res.json({ success: true, message: 'Folder access permissions updated' });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

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

  router.get('/admin/users', authenticate, requireAdmin, (req, res) => {
    const users = authService.getAllUsers();
    return res.json(users);
  });

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
  // CHUNKED UPLOAD ROUTES (DIRECT STORAGE IN SYSTEM FOLDER)
  // ==========================================

  router.post('/init', authenticate, (req, res) => {
    try {
      const { filename, filesize, chunksize, filehash, folderId } = req.body;

      if (!filename || !filesize || !chunksize || !folderId) {
        return res
          .status(400)
          .json({ error: 'filename, filesize, chunksize, and folderId are required' });
      }

      const folder = authService.getFolderById(folderId);
      if (!folder) {
        return res.status(404).json({ error: 'Target folder does not exist' });
      }

      if (!authService.canUserAccessFolder(req.user, folderId)) {
        return res
          .status(403)
          .json({ error: `You do not have permission to upload to folder "${folder.name}"` });
      }

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
        systemPath: folder.systemPath,
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
        systemPath: folder.systemPath,
        uploadedChunks: existingChunks,
        isComplete: existingChunks.length === totalChunks,
      });
    } catch (err) {
      console.error('Error initializing upload:', err);
      return res.status(500).json({ error: 'Internal server error initializing upload' });
    }
  });

  router.get('/status/:uploadId', authenticate, (req, res) => {
    const { uploadId } = req.params;
    const sessionDir = path.join(tempDir, uploadId);
    const metadataPath = path.join(sessionDir, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (!authService.canUserAccessFolder(req.user, metadata.folderId)) {
        return res.status(403).json({ error: 'Access denied to this upload session' });
      }
      return res.json(metadata);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read upload session metadata' });
    }
  });

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
   * Assemble all uploaded chunks directly into the actual system folder
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
      const { filename, totalChunks, folderId, systemPath, folderName, uploadedBy } = metadata;

      // Verify permission
      if (!authService.canUserAccessFolder(req.user, folderId)) {
        return res.status(403).json({ error: 'Permission denied' });
      }

      // Check all chunks
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(sessionDir, `chunk_${i}`);
        if (!fs.existsSync(chunkPath)) {
          return res.status(400).json({
            error: `Missing chunk ${i} of ${totalChunks}. Upload incomplete.`,
          });
        }
      }

      // Resolve destination directory from folder's actual system path
      const folderRecord = authService.getFolderById(folderId);
      const destSystemPath = folderRecord ? folderRecord.systemPath : systemPath;

      if (!fs.existsSync(destSystemPath)) {
        fs.mkdirSync(destSystemPath, { recursive: true });
      }

      const fileId = crypto.randomBytes(8).toString('hex');
      const sanitizedFilename = path.basename(filename).replace(/[^a-zA-Z0-9.-_]/g, '_');

      // Check if file already exists in actual system folder; if so, append fileId
      let finalFileName = sanitizedFilename;
      let finalFilePath = path.join(destSystemPath, finalFileName);

      if (fs.existsSync(finalFilePath)) {
        const ext = path.extname(sanitizedFilename);
        const nameWithoutExt = path.basename(sanitizedFilename, ext);
        finalFileName = `${nameWithoutExt}_${fileId.substring(0, 6)}${ext}`;
        finalFilePath = path.join(destSystemPath, finalFileName);
      }

      const writeStream = fs.createWriteStream(finalFilePath);

      // Stream chunks into target system folder file
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

      // Cleanup temp chunks
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn('Could not clean temp folder:', cleanupErr.message);
      }

      const mimeType = mime.lookup(filename) || 'application/octet-stream';
      const fileStats = fs.statSync(finalFilePath);

      const fileRecord = {
        fileId,
        originalName: filename,
        storedName: finalFileName,
        fullPath: finalFilePath,
        folderId,
        folderName: folderRecord ? folderRecord.name : folderName,
        systemPath: destSystemPath,
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
        message: 'File upload completed and stored in actual system folder successfully!',
        file: fileRecord,
      });
    } catch (err) {
      console.error('Error completing file upload:', err);
      return res.status(500).json({ error: 'Failed to assemble file chunks into system folder' });
    }
  });

  router.get('/files', authenticate, (req, res) => {
    const db = getFileDb();
    const allFiles = Object.values(db).sort(
      (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)
    );

    const allowedFiles = allFiles.filter((f) =>
      authService.canUserAccessFolder(req.user, f.folderId)
    );

    return res.json(allowedFiles);
  });

  router.delete('/files/:fileId', authenticate, (req, res) => {
    const { fileId } = req.params;
    const db = getFileDb();
    const fileRecord = db[fileId];

    if (!fileRecord) {
      return res.status(404).json({ error: 'File not found' });
    }

    const isOwner = fileRecord.uploadedBy && fileRecord.uploadedBy.id === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'Permission denied. You can only delete your own files.' });
    }

    // Delete from actual system file path
    const filePath = fileRecord.fullPath || path.join(fileRecord.systemPath || storageDir, fileRecord.storedName);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn('Could not unlink physical file:', err.message);
      }
    }

    delete db[fileId];
    saveFileDb(db);

    return res.json({ success: true, message: 'File deleted successfully' });
  });

  /**
   * HTTP 206 Byte Range Request Video Streaming & File Download
   * Directly reads from the actual physical file path on the system
   */
  const handleStreamOrDownload = (req, res, isDownload = false) => {
    const { fileId } = req.params;
    const db = getFileDb();
    const fileRecord = db[fileId];

    if (!fileRecord) {
      return res.status(404).send('File not found');
    }

    if (!authService.canUserAccessFolder(req.user, fileRecord.folderId)) {
      return res.status(403).send('Forbidden: Access denied to this folder');
    }

    // Locate actual physical file on the system
    let filePath = fileRecord.fullPath;
    if (!filePath || !fs.existsSync(filePath)) {
      filePath = path.join(fileRecord.systemPath || storageDir, fileRecord.storedName);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File missing on system disk');
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
