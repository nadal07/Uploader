const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');

// Secret for JWT signing - use environment variable or default
const JWT_SECRET = process.env.JWT_SECRET || 'cloudflare_tunnel_uploader_super_secret_jwt_key_2026';

/**
 * Standard Base64URL encoding/decoding helper
 */
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Standard RFC 7519 HMAC-SHA256 JWT Token Signing
 */
function signToken(payload, expiresInSeconds = 86400 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp, iat: Math.floor(Date.now() / 1000) };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Standard HMAC-SHA256 JWT Token Verification
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;

  // Re-compute expected signature
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  // Constant-time comparison
  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Password Hashing using Node.js built-in scrypt KDF (OWASP recommended)
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalKey] = storedHash.split(':');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');

  const bufA = Buffer.from(derivedKey, 'hex');
  const bufB = Buffer.from(originalKey, 'hex');

  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * AuthService Class managing users, actual system folders, and permissions
 */
class AuthService {
  constructor(storageDir) {
    this.storageDir = path.resolve(storageDir);
    this.dbFile = path.join(this.storageDir, 'auth_db.json');
    this.initDb();
  }

  initDb() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    const generalSystemPath = path.join(this.storageDir, 'general');
    const videosSystemPath = path.join(this.storageDir, 'videos');

    if (!fs.existsSync(generalSystemPath)) fs.mkdirSync(generalSystemPath, { recursive: true });
    if (!fs.existsSync(videosSystemPath)) fs.mkdirSync(videosSystemPath, { recursive: true });

    if (!fs.existsSync(this.dbFile)) {
      const defaultAdminPass = process.env.ADMIN_PASSWORD || 'admin123';
      const initialDb = {
        users: {
          u_admin: {
            id: 'u_admin',
            username: 'admin',
            passwordHash: hashPassword(defaultAdminPass),
            role: 'admin',
            allowedFolderIds: ['*'],
            mustChangePassword: true,
            createdAt: new Date().toISOString(),
          },
        },
        folders: {
          f_general: {
            id: 'f_general',
            name: 'General',
            systemPath: generalSystemPath,
            description: 'General shared files',
            createdAt: new Date().toISOString(),
            createdBy: 'admin',
          },
          f_videos: {
            id: 'f_videos',
            name: 'Videos',
            systemPath: videosSystemPath,
            description: 'Movies, streams, and media files',
            createdAt: new Date().toISOString(),
            createdBy: 'admin',
          },
        },
      };
      this.saveDb(initialDb);
    } else {
      // Migrate existing folders and users if needed
      const db = this.getDb();
      let changed = false;
      Object.values(db.folders || {}).forEach((folder) => {
        if (!folder.systemPath) {
          folder.systemPath = path.join(this.storageDir, folder.folderPath || folder.name.toLowerCase());
          changed = true;
          if (!fs.existsSync(folder.systemPath)) {
            fs.mkdirSync(folder.systemPath, { recursive: true });
          }
        }
      });
      Object.values(db.users || {}).forEach((user) => {
        if (user.mustChangePassword === undefined) {
          user.mustChangePassword = user.username === 'admin';
          changed = true;
        }
      });
      if (changed) this.saveDb(db);
    }
  }

  getDb() {
    try {
      return JSON.parse(fs.readFileSync(this.dbFile, 'utf8'));
    } catch {
      return { users: {}, folders: {} };
    }
  }

  saveDb(data) {
    fs.writeFileSync(this.dbFile, JSON.stringify(data, null, 2), 'utf8');
  }

  // --- Users ---
  getUserByUsername(username) {
    const db = this.getDb();
    return Object.values(db.users || {}).find(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );
  }

  getUserById(id) {
    const db = this.getDb();
    return db.users ? db.users[id] : null;
  }

  getAllUsers() {
    const db = this.getDb();
    return Object.values(db.users || {}).map((u) => {
      const { passwordHash, ...safeUser } = u;
      return safeUser;
    });
  }

  createUser({ username, password, role = 'user', allowedFolderIds = [], mustChangePassword = true }) {
    if (!username || !password) {
      throw new Error('Username and password are required');
    }
    const cleanUsername = username.trim();
    if (this.getUserByUsername(cleanUsername)) {
      throw new Error(`Username "${cleanUsername}" already exists`);
    }

    const db = this.getDb();
    const id = 'u_' + crypto.randomBytes(6).toString('hex');

    const newUser = {
      id,
      username: cleanUsername,
      passwordHash: hashPassword(password),
      role: role === 'admin' ? 'admin' : 'user',
      allowedFolderIds: role === 'admin' ? ['*'] : allowedFolderIds,
      mustChangePassword: mustChangePassword !== false,
      createdAt: new Date().toISOString(),
    };

    db.users[id] = newUser;
    this.saveDb(db);

    const { passwordHash, ...safeUser } = newUser;
    return safeUser;
  }

  updateUser(id, { role, allowedFolderIds, password, mustChangePassword }) {
    const db = this.getDb();
    const user = db.users[id];
    if (!user) throw new Error('User not found');

    if (role) {
      user.role = role === 'admin' ? 'admin' : 'user';
      if (user.role === 'admin') {
        user.allowedFolderIds = ['*'];
      }
    }

    if (Array.isArray(allowedFolderIds) && user.role !== 'admin') {
      user.allowedFolderIds = allowedFolderIds;
    }

    if (password && password.trim()) {
      user.passwordHash = hashPassword(password.trim());
      if (mustChangePassword !== undefined) {
        user.mustChangePassword = Boolean(mustChangePassword);
      }
    } else if (mustChangePassword !== undefined) {
      user.mustChangePassword = Boolean(mustChangePassword);
    }

    user.updatedAt = new Date().toISOString();
    this.saveDb(db);

    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  changeOwnPassword(userId, newPassword) {
    if (!newPassword || newPassword.trim().length < 4) {
      throw new Error('Password must be at least 4 characters long');
    }
    const db = this.getDb();
    const user = db.users[userId];
    if (!user) throw new Error('User not found');

    user.passwordHash = hashPassword(newPassword.trim());
    user.mustChangePassword = false;
    user.updatedAt = new Date().toISOString();
    this.saveDb(db);

    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  skipPasswordChange(userId) {
    const db = this.getDb();
    const user = db.users[userId];
    if (!user) throw new Error('User not found');
    if (user.role === 'admin') {
      throw new Error('Administrator password change is mandatory and cannot be skipped');
    }
    user.mustChangePassword = false;
    user.updatedAt = new Date().toISOString();
    this.saveDb(db);

    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  setFolderUsers(folderId, userIds) {
    const db = this.getDb();
    if (!db.folders[folderId]) throw new Error('Folder not found');

    const targetUserIds = new Set(Array.isArray(userIds) ? userIds : []);

    Object.values(db.users || {}).forEach((u) => {
      if (u.role !== 'admin') {
        u.allowedFolderIds = u.allowedFolderIds || [];
        if (targetUserIds.has(u.id)) {
          if (!u.allowedFolderIds.includes(folderId)) {
            u.allowedFolderIds.push(folderId);
          }
        } else {
          u.allowedFolderIds = u.allowedFolderIds.filter((fId) => fId !== folderId);
        }
      }
    });

    this.saveDb(db);
    return true;
  }

  getFolderAuthorizedUsers(folderId) {
    const db = this.getDb();
    return Object.values(db.users || {})
      .filter(
        (u) =>
          u.role === 'admin' ||
          (u.allowedFolderIds &&
            (u.allowedFolderIds.includes('*') || u.allowedFolderIds.includes(folderId)))
      )
      .map((u) => ({ id: u.id, username: u.username, role: u.role }));
  }

  deleteUser(id) {
    const db = this.getDb();
    if (!db.users[id]) throw new Error('User not found');
    if (db.users[id].username === 'admin') {
      throw new Error('Cannot delete default admin user');
    }
    delete db.users[id];
    this.saveDb(db);
    return true;
  }

  // --- Actual System Folders ---
  getAllFolders() {
    const db = this.getDb();
    return Object.values(db.folders || {});
  }

  getFolderById(id) {
    const db = this.getDb();
    return db.folders ? db.folders[id] : null;
  }

  /**
   * Creates a folder mapping to an actual directory on the system
   * @param {Object} options
   * @param {string} options.name Display name of folder
   * @param {string} [options.systemPath] Actual physical path on server (defaults to storageDir/<name>)
   * @param {string} [options.description]
   * @param {string} [options.createdBy]
   */
  createFolder({ name, systemPath, description = '', createdBy = 'admin' }) {
    if (!name || !name.trim()) throw new Error('Folder name is required');
    const cleanName = name.trim();

    // Determine actual physical system path
    let resolvedSystemPath;
    if (systemPath && systemPath.trim()) {
      resolvedSystemPath = path.resolve(systemPath.trim());
    } else {
      const folderSubdir = cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      resolvedSystemPath = path.resolve(path.join(this.storageDir, folderSubdir));
    }

    const db = this.getDb();
    const existing = Object.values(db.folders || {}).find(
      (f) =>
        f.name.toLowerCase() === cleanName.toLowerCase() ||
        path.resolve(f.systemPath) === resolvedSystemPath
    );
    if (existing) {
      throw new Error(`Folder with name "${cleanName}" or system path already exists`);
    }

    // Ensure the actual directory exists on the system
    if (!fs.existsSync(resolvedSystemPath)) {
      try {
        fs.mkdirSync(resolvedSystemPath, { recursive: true });
      } catch (err) {
        throw new Error(`Could not create system directory "${resolvedSystemPath}": ${err.message}`);
      }
    }

    const id = 'f_' + crypto.randomBytes(6).toString('hex');
    const newFolder = {
      id,
      name: cleanName,
      systemPath: resolvedSystemPath,
      description,
      createdAt: new Date().toISOString(),
      createdBy,
    };

    db.folders[id] = newFolder;
    this.saveDb(db);

    return newFolder;
  }

  deleteFolder(id) {
    const db = this.getDb();
    const folder = db.folders[id];
    if (!folder) throw new Error('Folder not found');

    delete db.folders[id];

    // Remove folder from user permissions
    Object.values(db.users || {}).forEach((u) => {
      if (Array.isArray(u.allowedFolderIds)) {
        u.allowedFolderIds = u.allowedFolderIds.filter((fId) => fId !== id);
      }
    });

    this.saveDb(db);
    return true;
  }

  /**
   * Scans the actual system folder directory to discover and index existing files
   * @param {string} folderId
   * @param {Function} getFileDb
   * @param {Function} saveFileDb
   */
  scanSystemFolder(folderId, getFileDb, saveFileDb) {
    const folder = this.getFolderById(folderId);
    if (!folder) throw new Error('Folder not found');

    if (!fs.existsSync(folder.systemPath)) {
      throw new Error(`System folder does not exist on disk: ${folder.systemPath}`);
    }

    const entries = fs.readdirSync(folder.systemPath, { withFileTypes: true });
    const fileDb = getFileDb();
    let discoveredCount = 0;

    entries.forEach((entry) => {
      if (entry.isFile() && !entry.name.startsWith('.')) {
        const fullFilePath = path.join(folder.systemPath, entry.name);
        const stats = fs.statSync(fullFilePath);

        // Check if file is already indexed in fileDb
        const alreadyIndexed = Object.values(fileDb).some(
          (f) => f.folderId === folder.id && (f.fullPath === fullFilePath || f.storedName === entry.name)
        );

        if (!alreadyIndexed) {
          const fileId = crypto.randomBytes(8).toString('hex');
          const mimeType = mime.lookup(entry.name) || 'application/octet-stream';

          fileDb[fileId] = {
            fileId,
            originalName: entry.name,
            storedName: entry.name,
            fullPath: fullFilePath,
            folderId: folder.id,
            folderName: folder.name,
            systemPath: folder.systemPath,
            size: stats.size,
            mimeType,
            uploadedAt: stats.mtime.toISOString(),
            uploadedBy: { id: 'system', username: 'system' },
            streamUrl: `/api/stream/${fileId}`,
            downloadUrl: `/api/download/${fileId}`,
            isDiscovered: true,
          };
          discoveredCount++;
        }
      }
    });

    if (discoveredCount > 0) {
      saveFileDb(fileDb);
    }

    return { totalFound: entries.length, newlyDiscovered: discoveredCount };
  }

  // --- Permission Checking ---
  canUserAccessFolder(user, folderId) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (!user.allowedFolderIds) return false;
    if (user.allowedFolderIds.includes('*')) return true;
    return user.allowedFolderIds.includes(folderId);
  }

  getUserAccessibleFolders(user) {
    const allFolders = this.getAllFolders();
    if (!user) return [];
    if (user.role === 'admin' || (user.allowedFolderIds && user.allowedFolderIds.includes('*'))) {
      return allFolders;
    }
    return allFolders.filter((f) => user.allowedFolderIds && user.allowedFolderIds.includes(f.id));
  }
}

module.exports = {
  AuthService,
  signToken,
  verifyToken,
  hashPassword,
  verifyPassword,
};
