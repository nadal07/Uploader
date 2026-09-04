# Cloudflare Tunnel Large File Uploader & Streamer

A resilient, resumable chunked upload and byte-range streaming solution designed specifically for self-hosted applications running behind **Cloudflare Tunnel**.

Bypass Cloudflare's **100MB/300MB HTTP payload limits** to upload multi-gigabyte files (videos, ISOs, archives) effortlessly, with **role-based user authentication**, **direct storage into actual host/server system folders**, directory scanning, and **HTTP 206 Partial Content (Byte Range Requests)** video streaming.

---

## ⚡ The Problem Solved

When self-hosting an application and exposing it via Cloudflare Tunnel:
1. **Upload Size Restriction**: Cloudflare limits individual HTTP request payloads to **100MB** on Free/Pro plans (and up to 300MB on Business/Enterprise). Direct file uploads exceeding this limit fail with `413 Payload Too Large`.
2. **Video Streaming Timeouts**: Monolithic downloads of large video files trigger Cloudflare buffer timeouts and high memory usage.
3. **Actual System Directory Organization**: Need uploaded files to land directly inside **real folders on your server / NAS filesystem** (e.g. `/mnt/storage/movies`, `/media/videos`, `/data/backups`) so they are immediately accessible to other server tools (Plex, Jellyfin, local file browsers), while letting admins decide which users can upload to which actual system folders.

### How This Solution Solves It
- **Client-Side Slicing**: Files are sliced in the browser into **10MB chunks** (customizable from 5MB to 50MB). Each chunk is an independent HTTP request comfortably below Cloudflare's limit.
- **Actual Physical System Folders**: Admins map folders to real filesystem paths anywhere on the server. Uploads are assembled directly into that directory with clean filenames.
- **Automatic Directory Scanning**: Discovers and indexes existing files already present in the target system folder, allowing instant streaming and downloading.
- **Role-Based Authentication**: Secure JWT token authentication with memory-hard `scrypt` password hashing.
- **Admin-Controlled Folder Permissions**: Admins grant specific users access to specific actual system folders. Users select their destination folder before uploading.
- **Resumable & Fault Tolerant**: Chunk states are tracked on both client (`localStorage`) and server. Network drops or browser refreshes automatically resume from the last verified chunk.
- **Byte-Range Video Streaming (HTTP 206)**: Serves video files with `Range: bytes=start-end` support directly from their actual system path, enabling HTML5 players to seek forward/backward instantly with token security.

---

## 🚀 Key Features

- **Multi-Gigabyte Uploads**: Upload 1GB, 5GB, 10GB+ files over Cloudflare Tunnel without hitting payload errors.
- **Actual System Folders**:
  - Save files directly into any real server directory (`/mnt/media`, `/var/data`, `./storage/movies`).
  - Scan existing files on disk with the click of a button.
- **User Authentication & Roles**:
  - `Admin`: Full access, manages users, folder mappings, and resets user passwords.
  - `User`: Can only view and upload to folders explicitly granted by the Admin.
- **First-Login Password Management**:
  - **Mandatory Admin Change**: The default administrator is required to set a new password on first login (cannot be skipped or dismissed).
  - **Optional User Change**: New users are prompted to set a personal password upon first login, but can opt out using "Skip for Now".
  - **Admin Password Reset**: Admins can reset the password for any user at any time and optionally re-enable the next-login password prompt.
- **Destination Folder Selection**: Users choose which actual system folder to upload into.
- **Live Chunk Matrix Visualizer**: Real-time dashboard showing every chunk's state (`Done`, `Uploading`, `Pending`, `Retry`).
- **Instant Video Playback**: Built-in video player with live HTTP 206 Byte-Range debugging.
- **Docker & Compose Ready**: Host volume mounts mapping real server folders into the container.

---

## 🔐 Default Credentials & First Login Policy

On first run, the server automatically bootstraps an administrator account:
- **Username**: `admin`
- **Password**: `admin123` *(or configured via `ADMIN_PASSWORD` environment variable)*

### First Login Flow
1. **Admin**: When `admin` logs in for the first time, a **mandatory modal** appears requiring a new secure password. Navigation and skipping are blocked until a new password is saved.
2. **Users**: When created, users are prompted on first login with an option to change their password or **Skip for Now**.
3. **Admin Resets**: In the Admin Console under the **Users & Permissions** tab, click **🔑 Password** next to any user to assign a new password immediately.

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
│   ├── style.css               # Modern dark theme styles
│   └── app.js                  # Frontend controller
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
