# Cloudflare Tunnel Large File Uploader & Streamer

A resilient, resumable chunked upload and byte-range streaming solution designed specifically for self-hosted applications running behind **Cloudflare Tunnel**.

Bypass Cloudflare's **100MB/300MB HTTP payload limits** to upload multi-gigabyte files (videos, ISOs, archives) effortlessly, with **role-based user authentication**, **folder upload access control**, and **HTTP 206 Partial Content (Byte Range Requests)** video streaming.

---

## ⚡ The Problem Solved

When self-hosting an application and exposing it via Cloudflare Tunnel:
1. **Upload Size Restriction**: Cloudflare limits individual HTTP request payloads to **100MB** on Free/Pro plans (and up to 300MB on Business/Enterprise). Direct file uploads exceeding this limit fail with `413 Payload Too Large`.
2. **Video Streaming Timeouts**: Monolithic downloads of large video files trigger Cloudflare buffer timeouts and high memory usage.
3. **Multi-User Security & Organization**: Need to control who can upload, where files are stored, and restrict user access to specific folders (e.g. Movies, Backups, Shared).

### How This Solution Solves It
- **Client-Side Slicing**: Files are sliced in the browser into **10MB chunks** (customizable from 5MB to 50MB). Each chunk is an independent HTTP request comfortably below Cloudflare's limit.
- **Role-Based Authentication**: Secure JWT token authentication with memory-hard `scrypt` password hashing.
- **Admin-Controlled Folder Permissions**: Admins create folders and grant specific users access to specific folders. Users select their destination folder from an authorized dropdown.
- **Resumable & Fault Tolerant**: Chunk states are tracked on both client (`localStorage`) and server. Network drops or browser refreshes automatically resume from the last verified chunk.
- **Byte-Range Video Streaming (HTTP 206)**: Serves video files with `Range: bytes=start-end` support, enabling HTML5 players to seek forward/backward instantly with token security.

---

## 🚀 Key Features

- **Multi-Gigabyte Uploads**: Upload 1GB, 5GB, 10GB+ files over Cloudflare Tunnel without hitting payload errors.
- **User Authentication & Roles**:
  - `Admin`: Full access, manages users, passwords, and folders.
  - `User`: Can only view and upload to folders explicitly granted by the Admin.
- **Destination Folder Selection**: Users choose which folder to upload into from their assigned folders.
- **Live Chunk Matrix Visualizer**: Real-time dashboard showing every chunk's state (`Done`, `Uploading`, `Pending`, `Retry`).
- **Instant Video Playback**: Built-in video player with live HTTP 206 Byte-Range debugging.
- **Docker & Compose Ready**: Production-grade Docker container with volume persistence and health checks.

---

## 🔐 Default Credentials (Initial Setup)

On first run, the server automatically bootstraps an administrator account:
- **Username**: `admin`
- **Password**: `admin123` *(or configured via `ADMIN_PASSWORD` environment variable)*

Log in as `admin` to create additional users, assign folder permissions, and create storage folders via the **🛠️ Admin Console**.

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
│   ├── auth-service.js         # Scrypt hashing, JWT tokens, users & folders DB
│   ├── uploader-client.js      # Browser JS SDK with auth & folder support
│   └── uploader-server.js      # Express router for auth, chunking & range streaming
├── public/
│   ├── index.html              # Dashboard UI with login & admin console modals
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
| `/api/auth/login` | `POST` | Public | Authenticates user; returns JWT token and accessible folders. |
| `/api/auth/me` | `GET` | User | Retrieves current user profile and folder permissions. |
| `/api/auth/password` | `PUT` | User | Updates current user's password. |
| `/api/folders` | `GET` | User | Lists folders accessible to current user (all for admin). |
| `/api/folders` | `POST` | Admin | Creates a new storage folder on disk. |
| `/api/folders/:folderId` | `DELETE` | Admin | Deletes a folder. |
| `/api/admin/users` | `GET` | Admin | Lists all registered users and their folder permissions. |
| `/api/admin/users` | `POST` | Admin | Creates a user with assigned `allowedFolderIds`. |
| `/api/admin/users/:userId`| `DELETE` | Admin | Deletes a user account. |
| `/api/init` | `POST` | User | Initializes upload session for authorized `folderId`. |
| `/api/chunk` | `POST` | User | Uploads an individual binary chunk (<10MB). |
| `/api/complete` | `POST` | User | Assembles chunks into target folder directory on disk. |
| `/api/files` | `GET` | User | Lists uploaded files in accessible folders. |
| `/api/stream/:fileId` | `GET` | User | Streams file via **HTTP 206 Partial Content** (supports `?token=`). |
| `/api/download/:fileId`| `GET` | User | Downloads file as attachment (supports `?token=`). |

---

## 🧪 Testing

Run the automated test suite to verify authentication, folder permission enforcement, unauthorized upload blocking (403), 25MB chunk reassembly, and HTTP 206 streaming:
```bash
npm test
```

---

## 📄 License
MIT
