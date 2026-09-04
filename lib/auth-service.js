const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Secret for JWT signing - use environment variable or generated persistent secret
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
    // Check expiration
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
 * AuthService Class managing users, folders, and permissions
 */
class AuthService {
  constructor(storageDir) {
    this.storageDir = storageDir;
    this.dbFile = path.join(storageDir, 'auth_db.json');
    this.initDb();
  }

  initDb() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    if (!fs.existsSync(this.dbFile)) {
      // Default initial bootstrap
      const defaultAdminPass = process.env.ADMIN_PASSWORD || 'admin123';
      const initialDb = {
        users: {
          u_admin: {
            id: 'u_admin',
            username: 'admin',
            passwordHash: hashPassword(defaultAdminPass),
            role: 'admin',
            allowedFolderIds: ['*'],
            createdAt: new Date().toISOString(),
          },
        },
        folders: {
          f_general: {
            id: 'f_general',
            name: 'General',
            folderPath: 'general',
            description: 'General shared files',
            createdAt: new Date().toISOString(),
            createdBy: 'admin',
          },
          f_videos: {
            id: 'f_videos',
            name: 'Videos',
            folderPath: 'videos',
            description: 'Movies, streams, and media files',
            createdAt: new Date().toISOString(),
            createdBy: 'admin',
          },
        },
      };
      this.saveDb(initialDb);

      // Create initial physical folder directories on disk
      fs.mkdirSync(path.join(this.storageDir, 'general'), { recursive: true });
      fs.mkdirSync(path.join(this.storageDir, 'videos'), { recursive: true });
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

  createUser({ username, password, role = 'user', allowedFolderIds = [] }) {
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
      createdAt: new Date().toISOString(),
    };

    db.users[id] = newUser;
    this.saveDb(db);

    const { passwordHash, ...safeUser } = newUser;
    return safeUser;
  }

  updateUser(id, { role, allowedFolderIds, password }) {
    const db = this.getDb();
    const user = db.users[id];
    if (!user) throw new Error('User not found');

    if (role) {
      user.role = role === 'admin' ? 'admin' : 'user';
      if (user.role === 'admin') {
        user.allowedFolderIds = ['*'];
      }
    }

    if (allowedFolderIds && user.role !== 'admin') {
      user.allowedFolderIds = allowedFolderIds;
    }

    if (password && password.trim()) {
      user.passwordHash = hashPassword(password.trim());
    }

    user.updatedAt = new Date().toISOString();
    this.saveDb(db);

    const { passwordHash, ...safeUser } = user;
    return safeUser;
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

  // --- Folders ---
  getAllFolders() {
    const db = this.getDb();
    return Object.values(db.folders || {});
  }

  getFolderById(id) {
    const db = this.getDb();
    return db.folders ? db.folders[id] : null;
  }

  createFolder({ name, description = '', createdBy = 'admin' }) {
    if (!name || !name.trim()) throw new Error('Folder name is required');
    const cleanName = name.trim();
    const folderPath = cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    const db = this.getDb();
    const existing = Object.values(db.folders || {}).find(
      (f) => f.name.toLowerCase() === cleanName.toLowerCase() || f.folderPath === folderPath
    );
    if (existing) {
      throw new Error(`Folder with name "${cleanName}" already exists`);
    }

    const id = 'f_' + crypto.randomBytes(6).toString('hex');
    const newFolder = {
      id,
      name: cleanName,
      folderPath,
      description,
      createdAt: new Date().toISOString(),
      createdBy,
    };

    db.folders[id] = newFolder;
    this.saveDb(db);

    // Create physical directory on disk
    const physicalPath = path.join(this.storageDir, folderPath);
    if (!fs.existsSync(physicalPath)) {
      fs.mkdirSync(physicalPath, { recursive: true });
    }

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
