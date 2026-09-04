# VaultStream — Resumable Chunked File Uploader & Media Server

VaultStream is a high-performance, resilient, resumable chunked upload and HTTP 206 byte-range streaming solution designed for self-hosted infrastructure, NAS systems, and reverse proxies.

It features **role-based access control**, **direct storage into real host/server system directories**, **instant directory indexing**, and **seamless HTML5 video playback** with seeking.

---

## ⚡ Key Highlights & Capabilities

- **Resumable Chunked Transfers**: Client-side slicing divides multi-gigabyte files (videos, ISOs, raw datasets) into lightweight, independent HTTP chunk requests. Network drops or page refreshes automatically resume from the last completed chunk.
- **🛡️ Cloudflare Tunnel & Proxy Limit Bypass**:
  > [!TIP]
  > **Effortlessly Bypass Cloudflare 100MB/300MB Payload Limits**
  > 
  > Self-hosted servers exposed through **Cloudflare Tunnel** normally reject any upload exceeding Cloudflare's HTTP request body ceiling (**100MB** on Free/Pro plans, **300MB** on Business/Enterprise) with `413 Payload Too Large`.
  > 
  > VaultStream breaks transfers into **10MB chunks** (configurable from 5MB to 50MB), completely bypassing Cloudflare Tunnel's payload restrictions and connection timeout limits. This also eliminates upload failures behind Nginx `client_max_body_size`, Traefik, Caddy, or unstable mobile connections.
- **Physical Server System Folders**: Mapped directly to real filesystem paths anywhere on your host (e.g. `/mnt/storage/movies`, `/media/videos`, `/data/backups`). Uploaded files land with clean filenames, immediately accessible to Plex, Jellyfin, or local file explorers.
- **Automatic Directory Scanning**: Index and stream existing files already sitting on disk with one click.
- **Dual Light & Dark Themes**: Fully integrated theme engine with automatic OS detection (`prefers-color-scheme`) and persistent instant toggle.
- **Granular Folder Permissions**: Admins assign specific users to specific physical system folders. Users can only see and upload to folders explicitly granted to them.
- **First-Login Password Policy**: Mandatory password change for default administrators, optional with skip for regular users, plus on-demand admin password resets.
- **Byte-Range Media Streaming (HTTP 206)**: Streams video files with `Range: bytes=start-end` support directly from their actual system path, enabling instantaneous seeking without buffering full video files.

---

## 🚀 Key Features

- **Multi-Gigabyte Transfers**: Upload 1GB, 5GB, 20GB+ files reliably without hitting proxy timeouts or payload limits.
- **Actual System Folders**:
  - Store files directly into any real server directory (`/mnt/media`, `/var/data`, `./storage/movies`).
  - Scan existing files on disk with the click of a button.
- **User Authentication & Roles**:
  - `Admin`: Full access, manages users, folder mappings, and resets user passwords.
  - `User`: Can only view and upload to folders explicitly granted by the Admin.
- **First-Login Password Management**:
  - **Mandatory Admin Change**: The default administrator is required to set a new password on first login (cannot be skipped or dismissed).
  - **Optional User Change**: New users are prompted to set a personal password upon first login, but can opt out using "Skip for Now".
  - **Admin Password Reset**: Admins can reset the password for any user at any time and optionally re-enable the next-login password prompt.
- **Destination Folder Selection**: Users choose which actual system folder to upload into.
- **Live Transfer Matrix**: Real-time dashboard showing every chunk's state (`Done`, `Uploading`, `Pending`, `Retry`).
- **Instant Video Playback**: Built-in video player with live HTTP 206 Byte-Range streaming monitor.
- **Light & Dark Mode**: Professional UI with instant theme toggle and smooth transitions.
- **Docker & Compose Ready**: Host volume mounts mapping real server folders into the container.

---

## 🔐 Default Credentials & First Login Policy

On first run, the server automatically bootstraps an administrator account:
- **Username**: `admin`
- **Password**: `admin123` *(or configured via `ADMIN_PASSWORD` environment variable)*

### First Login Flow
1. **Admin**: When `admin` logs in for the first time, a **mandatory modal** appears requiring a new secure password. Navigation and skipping are blocked until a new password is saved.
2. **Users**: When created, users are prompted on first login with an option to change their password or **Skip for Now**.
3. **Admin Resets**: In the Admin Console under the **Users & Permissions** tab, click **Password** next to any user to assign a new password immediately.

---

## 📁 Repository Structure

```
├── Dockerfile                  # Production Node.js 20 Alpine container
├── docker-compose.yml          # Docker Compose with actual host folder mounts
├── .dockerignore               # Docker build exclusions
├── .gitignore                  # Git ignore rules (node_modules, uploads)
├── server.js                   # Main application server entry point
├── package.json                # Project dependencies and test scripts
├── lib/
│   ├── auth-service.js         # Scrypt hashing, JWT tokens, actual system folder scanning
│   ├── uploader-client.js      # Browser JS SDK with auth & folder support
│   └── uploader-server.js      # Express router for chunk merging & range streaming
├── public/
│   ├── index.html              # Dashboard UI with login & admin console modals
│   ├── style.css               # Modern dual light/dark theme styles
│   └── app.js                  # Frontend controller & theme engine
└── scripts/
    └── test-uploader.js        # Automated verification test suite
```

---

## 🐳 Quick Start (Docker with Host Folders)

In `docker-compose.yml`, mount your real host folders:
```yaml
volumes:
  - ./uploads:/app/uploads
  # Mount any actual host directories:
  - /mnt/storage:/mnt/storage
  - /media:/media
```

Start the container:
```bash
docker compose up -d --build
```
Open `http://localhost:3000` in your browser.

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

## 📡 API Reference

| Endpoint | Method | Auth | Description |
| :--- | :--- | :--- | :--- |
| `/api/auth/login` | `POST` | Public | Authenticates user; returns JWT token, `mustChangePassword`, and folders. |
| `/api/auth/me` | `GET` | User | Retrieves current user profile and folder permissions. |
| `/api/auth/password` | `PUT` | User | Updates caller's password; clears `mustChangePassword`. |
| `/api/auth/skip-password-change`| `POST` | User | Skips first-login prompt (blocked for admin). |
| `/api/folders` | `GET` | User | Lists folders accessible to current user (all for admin). |
| `/api/folders` | `POST` | Admin | Maps a new folder to an **actual system directory path**. |
| `/api/folders/:folderId/scan`| `POST` | Admin | **Scans actual system folder** on disk to index existing files. |
| `/api/folders/:folderId/users`| `GET` | Admin | Gets users authorized for a specific folder. |
| `/api/folders/:folderId/users`| `PUT` | Admin | Updates authorized users for a specific folder. |
| `/api/folders/:folderId` | `DELETE` | Admin | Deletes a folder mapping (files remain intact on disk). |
| `/api/admin/users` | `GET` | Admin | Lists all registered users and their folder permissions. |
| `/api/admin/users` | `POST` | Admin | Creates a user with assigned `allowedFolderIds`. |
| `/api/admin/users/:userId`| `PUT` | Admin | Updates user role, permissions, or **resets password**. |
| `/api/admin/users/:userId`| `DELETE` | Admin | Deletes a user account. |
| `/api/init` | `POST` | User | Initializes upload session for authorized `folderId`. |
| `/api/chunk` | `POST` | User | Uploads an individual binary chunk (<10MB). |
| `/api/complete` | `POST` | User | Assembles chunks directly into the **actual system folder**. |
| `/api/files` | `GET` | User | Lists uploaded/discovered files in accessible folders. |
| `/api/stream/:fileId` | `GET` | User | Streams file via **HTTP 206 Partial Content** from system path. |
| `/api/download/:fileId`| `GET` | User | Downloads file as attachment (supports `?token=`). |

---

## 🧪 Testing

Run the automated test suite to verify actual system path mapping, directory scanning, permission enforcement, 25MB chunk reassembly in host storage, and HTTP 206 streaming:
```bash
npm test
```

---

## 📄 License
MIT
