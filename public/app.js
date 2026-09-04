document.addEventListener('DOMContentLoaded', () => {
  // Auth state
  let authToken = localStorage.getItem('uploader_auth_token') || null;
  let currentUser = null;
  let accessibleFolders = [];
  let uploader = null;

  // Elements - Header & User
  const userProfileArea = document.getElementById('userProfileArea');
  const currentUsername = document.getElementById('currentUsername');
  const currentUserRole = document.getElementById('currentUserRole');
  const adminConsoleBtn = document.getElementById('adminConsoleBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  // Elements - Login Modal
  const loginModal = document.getElementById('loginModal');
  const loginForm = document.getElementById('loginForm');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const loginErrorMsg = document.getElementById('loginErrorMsg');

  // Elements - Upload & Folders
  const targetFolderSelect = document.getElementById('targetFolderSelect');
  const folderFilterSelect = document.getElementById('folderFilterSelect');
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const configToggleBtn = document.getElementById('configToggleBtn');
  const settingsDrawer = document.getElementById('settingsDrawer');
  const chunkSizeSelect = document.getElementById('chunkSizeSelect');
  const concurrencySelect = document.getElementById('concurrencySelect');

  // Elements - Active Upload UI
  const activeUploadContainer = document.getElementById('activeUploadContainer');
  const uploadFileName = document.getElementById('uploadFileName');
  const uploadFileSize = document.getElementById('uploadFileSize');
  const uploadFolderBadge = document.getElementById('uploadFolderBadge');
  const progressBarFill = document.getElementById('progressBarFill');
  const statPercent = document.getElementById('statPercent');
  const statSpeed = document.getElementById('statSpeed');
  const statEta = document.getElementById('statEta');
  const statChunks = document.getElementById('statChunks');
  const chunkGrid = document.getElementById('chunkGrid');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const cancelBtn = document.getElementById('cancelBtn');

  // Elements - File Gallery
  const fileGrid = document.getElementById('fileGrid');
  const emptyState = document.getElementById('emptyState');
  const refreshFilesBtn = document.getElementById('refreshFilesBtn');

  // Elements - Admin Modal
  const adminModal = document.getElementById('adminModal');
  const closeAdminModalBtn = document.getElementById('closeAdminModalBtn');
  const tabUsersBtn = document.getElementById('tabUsersBtn');
  const tabFoldersBtn = document.getElementById('tabFoldersBtn');
  const tabUsersContent = document.getElementById('tabUsersContent');
  const tabFoldersContent = document.getElementById('tabFoldersContent');
  const createUserForm = document.getElementById('createUserForm');
  const newUsername = document.getElementById('newUsername');
  const newPassword = document.getElementById('newPassword');
  const newRole = document.getElementById('newRole');
  const folderCheckboxesGroup = document.getElementById('folderCheckboxesGroup');
  const allowedFoldersCheckboxList = document.getElementById('allowedFoldersCheckboxList');
  const adminUsersList = document.getElementById('adminUsersList');
  const createFolderForm = document.getElementById('createFolderForm');
  const newFolderName = document.getElementById('newFolderName');
  const newFolderDesc = document.getElementById('newFolderDesc');
  const adminFoldersList = document.getElementById('adminFoldersList');

  // Elements - Video Stream Modal
  const videoModal = document.getElementById('videoModal');
  const modalVideoTitle = document.getElementById('modalVideoTitle');
  const videoPlayer = document.getElementById('videoPlayer');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const rangeLog = document.getElementById('rangeLog');

  // Helper for Authenticated Fetch
  async function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (authToken) {
      options.headers['Authorization'] = `Bearer ${authToken}`;
    }
    const res = await fetch(url, options);
    if (res.status === 401) {
      // Token expired or invalid
      handleLogout();
      throw new Error('Session expired. Please log in again.');
    }
    return res;
  }

  // Check initial authentication
  async function checkAuth() {
    if (!authToken) {
      showLoginModal();
      return;
    }
    try {
      const res = await authFetch('/api/auth/me');
      if (!res.ok) throw new Error('Auth failed');
      const data = await res.json();
      setupUserSession(data.user, data.accessibleFolders);
    } catch {
      showLoginModal();
    }
  }

  function showLoginModal() {
    loginModal.classList.remove('hidden');
    userProfileArea.classList.add('hidden');
    loginUsername.focus();
  }

  function setupUserSession(user, folders) {
    currentUser = user;
    accessibleFolders = folders || [];

    // Header UI
    currentUsername.textContent = user.username;
    currentUserRole.textContent = user.role;
    currentUserRole.className = `role-badge ${user.role}`;

    if (user.role === 'admin') {
      adminConsoleBtn.classList.remove('hidden');
    } else {
      adminConsoleBtn.classList.add('hidden');
    }

    userProfileArea.classList.remove('hidden');
    loginModal.classList.add('hidden');

    populateFolderSelectors();
    loadFiles();
  }

  // Login form handler
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginErrorMsg.classList.add('hidden');
    loginErrorMsg.textContent = '';

    const username = loginUsername.value.trim();
    const password = loginPassword.value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      authToken = data.token;
      localStorage.setItem('uploader_auth_token', authToken);
      setupUserSession(data.user, data.accessibleFolders);
      loginForm.reset();
    } catch (err) {
      loginErrorMsg.textContent = err.message;
      loginErrorMsg.classList.remove('hidden');
    }
  });

  // Logout handler
  function handleLogout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('uploader_auth_token');
    showLoginModal();
  }

  logoutBtn.addEventListener('click', handleLogout);

  // Populate Destination Folder Dropdown and Gallery Filter
  function populateFolderSelectors() {
    targetFolderSelect.innerHTML = '';
    folderFilterSelect.innerHTML = '<option value="ALL">All Accessible Folders</option>';

    if (accessibleFolders.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No folders assigned. Contact admin.';
      opt.disabled = true;
      opt.selected = true;
      targetFolderSelect.appendChild(opt);
      return;
    }

    accessibleFolders.forEach((f, index) => {
      // Upload folder select
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = `📁 ${f.name} (${f.description || f.folderPath})`;
      if (index === 0) opt.selected = true;
      targetFolderSelect.appendChild(opt);

      // Gallery filter select
      const filterOpt = document.createElement('option');
      filterOpt.value = f.id;
      filterOpt.textContent = `📁 ${f.name}`;
      folderFilterSelect.appendChild(filterOpt);
    });
  }

  // Toggle settings drawer
  configToggleBtn.addEventListener('click', () => {
    settingsDrawer.classList.toggle('hidden');
  });

  // Browse file button
  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  // Drag & drop handlers
  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleSelectedFile(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleSelectedFile(e.target.files[0]);
    }
  });

  // Handle selected file upload initiation with authentication & folder
  function handleSelectedFile(file) {
    const selectedFolderId = targetFolderSelect.value;
    if (!selectedFolderId) {
      alert('⚠️ Please select an authorized destination folder first.');
      return;
    }

    const selectedFolder = accessibleFolders.find((f) => f.id === selectedFolderId);
    const folderName = selectedFolder ? selectedFolder.name : 'Folder';

    const chunkSize = parseInt(chunkSizeSelect.value, 10);
    const concurrency = parseInt(concurrencySelect.value, 10);

    uploader = new UploaderClient({
      apiBaseUrl: '/api',
      chunkSize: chunkSize,
      concurrency: concurrency,
      authToken: authToken,
      folderId: selectedFolderId,
    });

    // Setup visual UI elements
    uploadFileName.textContent = file.name;
    uploadFileSize.textContent = formatBytes(file.size);
    uploadFolderBadge.textContent = `📁 ${folderName}`;
    activeUploadContainer.classList.remove('hidden');
    pauseBtn.classList.remove('hidden');
    resumeBtn.classList.add('hidden');

    // Attach uploader library event callbacks
    uploader
      .on('init', (data) => {
        renderChunkGrid(data.totalChunks, data.uploadedChunks);
        statChunks.textContent = `${data.uploadedChunks.length} / ${data.totalChunks}`;
      })
      .on('progress', (data) => {
        progressBarFill.style.width = `${data.percent}%`;
        statPercent.textContent = `${data.percent}%`;
        statSpeed.textContent = `${formatBytes(data.speedBytesPerSec)}/s`;
        statEta.textContent = data.etaSec > 0 ? `${data.etaSec}s` : '0s';

        const completedCount = data.chunkStates.filter((s) => s === 'done').length;
        statChunks.textContent = `${completedCount} / ${data.chunkStates.length}`;

        updateChunkGridStates(data.chunkStates);
      })
      .on('chunkSuccess', () => {})
      .on('pause', () => {
        pauseBtn.classList.add('hidden');
        resumeBtn.classList.remove('hidden');
      })
      .on('resume', () => {
        resumeBtn.classList.add('hidden');
        pauseBtn.classList.remove('hidden');
      })
      .on('complete', (result) => {
        activeUploadContainer.classList.add('hidden');
        alert(`🎉 Upload complete! File saved in folder "${result.fileRecord.folderName}"`);
        loadFiles();
      })
      .on('error', (err) => {
        alert(`Upload error: ${err.message}`);
      });

    uploader.start(file);
  }

  // Render initial chunk grid boxes
  function renderChunkGrid(totalChunks, uploadedChunks) {
    chunkGrid.innerHTML = '';
    const uploadedSet = new Set(uploadedChunks);

    for (let i = 0; i < totalChunks; i++) {
      const box = document.createElement('div');
      box.className = 'chunk-box';
      box.id = `chunk-box-${i}`;
      if (uploadedSet.has(i)) {
        box.classList.add('done');
      }
      chunkGrid.appendChild(box);
    }
  }

  // Update chunk grid states
  function updateChunkGridStates(states) {
    states.forEach((state, idx) => {
      const box = document.getElementById(`chunk-box-${idx}`);
      if (box) {
        box.className = `chunk-box ${state}`;
      }
    });
  }

  // Upload action buttons
  pauseBtn.addEventListener('click', () => uploader && uploader.pause());
  resumeBtn.addEventListener('click', () => uploader && uploader.resume());
  cancelBtn.addEventListener('click', () => {
    if (uploader) {
      uploader.cancel();
      activeUploadContainer.classList.add('hidden');
    }
  });

  // Load uploaded files list from server
  async function loadFiles() {
    if (!authToken) return;
    try {
      const response = await authFetch('/api/files');
      if (!response.ok) return;
      const allFiles = await response.json();

      const selectedFilter = folderFilterSelect.value;
      const files =
        selectedFilter === 'ALL'
          ? allFiles
          : allFiles.filter((f) => f.folderId === selectedFilter);

      if (files.length === 0) {
        emptyState.classList.remove('hidden');
        fileGrid.innerHTML = '';
        return;
      }

      emptyState.classList.add('hidden');
      fileGrid.innerHTML = '';

      files.forEach((file) => {
        const fileCard = document.createElement('div');
        fileCard.className = 'file-item';

        const isVideo = file.mimeType.startsWith('video/');
        const icon = isVideo ? '🎬' : file.mimeType.startsWith('audio/') ? '🎵' : '📄';
        const folderName = file.folderName || 'General';
        const uploaderName = file.uploadedBy ? file.uploadedBy.username : 'Unknown';

        // URLs with embedded token for media streaming and downloads
        const authenticatedStreamUrl = `${file.streamUrl}?token=${encodeURIComponent(authToken)}`;
        const authenticatedDownloadUrl = `${file.downloadUrl}?token=${encodeURIComponent(authToken)}`;

        fileCard.innerHTML = `
          <div class="file-item-left">
            <span class="file-icon">${icon}</span>
            <div class="file-details">
              <h4>${escapeHtml(file.originalName)}</h4>
              <p>
                <span class="file-tag">📁 ${escapeHtml(folderName)}</span>
                <span>${formatBytes(file.size)}</span>
                <span class="uploader-tag">by @${escapeHtml(uploaderName)}</span>
                <span>• ${new Date(file.uploadedAt).toLocaleString()}</span>
              </p>
            </div>
          </div>
          <div class="file-item-actions">
            ${isVideo ? `<button class="btn btn-sm btn-primary play-btn" data-url="${authenticatedStreamUrl}" data-title="${escapeHtml(file.originalName)}">Stream</button>` : ''}
            <a href="${authenticatedDownloadUrl}" class="btn btn-sm btn-secondary" download>Download</a>
            <button class="btn btn-sm btn-secondary copy-btn" data-url="${window.location.origin}${authenticatedStreamUrl}">Copy Link</button>
            <button class="btn btn-sm btn-danger delete-btn" data-id="${file.fileId}">Delete</button>
          </div>
        `;
        fileGrid.appendChild(fileCard);
      });

      // Event listeners for file actions
      document.querySelectorAll('.play-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const url = e.target.getAttribute('data-url');
          const title = e.target.getAttribute('data-title');
          openVideoModal(url, title);
        });
      });

      document.querySelectorAll('.copy-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const url = e.target.getAttribute('data-url');
          navigator.clipboard.writeText(url);
          alert('Stream URL copied to clipboard!');
        });
      });

      document.querySelectorAll('.delete-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const fileId = e.target.getAttribute('data-id');
          if (confirm('Are you sure you want to delete this file?')) {
            const res = await authFetch(`/api/files/${fileId}`, { method: 'DELETE' });
            if (res.ok) {
              loadFiles();
            } else {
              const err = await res.json();
              alert(err.error || 'Failed to delete file');
            }
          }
        });
      });
    } catch (err) {
      console.error('Error loading files:', err);
    }
  }

  refreshFilesBtn.addEventListener('click', loadFiles);
  folderFilterSelect.addEventListener('change', loadFiles);

  // Video Streaming Modal & Range Debugger
  function openVideoModal(authenticatedStreamUrl, title) {
    modalVideoTitle.textContent = `Streaming: ${title}`;
    videoPlayer.src = authenticatedStreamUrl;
    videoModal.classList.remove('hidden');
    videoPlayer.play();

    rangeLog.innerHTML = `[${new Date().toLocaleTimeString()}] Video initialized with secure token. Requesting HTTP Range bytes=0- ...`;

    videoPlayer.onseeking = () => {
      const currentTime = videoPlayer.currentTime.toFixed(1);
      const logEntry = `[${new Date().toLocaleTimeString()}] Seek to timestamp ${currentTime}s -> Triggered HTTP 206 Partial Content Range Request`;
      rangeLog.innerHTML = `${logEntry}<br>${rangeLog.innerHTML}`;
    };
  }

  closeModalBtn.addEventListener('click', () => {
    videoPlayer.pause();
    videoPlayer.src = '';
    videoModal.classList.add('hidden');
  });

  // ==========================================
  // ADMIN CONSOLE MODAL
  // ==========================================
  adminConsoleBtn.addEventListener('click', () => {
    openAdminModal();
  });

  closeAdminModalBtn.addEventListener('click', () => {
    adminModal.classList.add('hidden');
  });

  function openAdminModal() {
    adminModal.classList.remove('hidden');
    switchAdminTab('users');
    loadAdminUsers();
    loadAdminFolders();
  }

  // Admin Tab Switcher
  tabUsersBtn.addEventListener('click', () => switchAdminTab('users'));
  tabFoldersBtn.addEventListener('click', () => switchAdminTab('folders'));

  function switchAdminTab(tab) {
    if (tab === 'users') {
      tabUsersBtn.classList.add('active');
      tabFoldersBtn.classList.remove('active');
      tabUsersContent.classList.remove('hidden');
      tabFoldersContent.classList.add('hidden');
    } else {
      tabFoldersBtn.classList.add('active');
      tabUsersBtn.classList.remove('active');
      tabFoldersContent.classList.remove('hidden');
      tabUsersContent.classList.add('hidden');
    }
  }

  // Role select in add user form: toggle folder checkboxes
  newRole.addEventListener('change', () => {
    if (newRole.value === 'admin') {
      folderCheckboxesGroup.classList.add('hidden');
    } else {
      folderCheckboxesGroup.classList.remove('hidden');
    }
  });

  // Load Users in Admin Console
  async function loadAdminUsers() {
    try {
      const res = await authFetch('/api/admin/users');
      if (!res.ok) return;
      const users = await res.json();

      adminUsersList.innerHTML = '';
      users.forEach((u) => {
        const row = document.createElement('div');
        row.className = 'user-row';

        let foldersText = 'None';
        if (u.role === 'admin' || (u.allowedFolderIds && u.allowedFolderIds.includes('*'))) {
          foldersText = 'All Folders (Admin)';
        } else if (u.allowedFolderIds && u.allowedFolderIds.length > 0) {
          const names = u.allowedFolderIds
            .map((id) => {
              const f = accessibleFolders.find((folder) => folder.id === id);
              return f ? f.name : id;
            })
            .join(', ');
          foldersText = names || 'Assigned Folders';
        }

        row.innerHTML = `
          <div class="user-row-meta">
            <h5>${escapeHtml(u.username)} <span class="role-badge ${u.role}">${u.role}</span></h5>
            <p>Access: ${escapeHtml(foldersText)}</p>
          </div>
          <div class="user-row-actions">
            ${u.username !== 'admin' ? `<button class="btn btn-sm btn-danger delete-user-btn" data-id="${u.id}">Delete</button>` : '<span class="folder-note">Protected</span>'}
          </div>
        `;
        adminUsersList.appendChild(row);
      });

      document.querySelectorAll('.delete-user-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const userId = e.target.getAttribute('data-id');
          if (confirm('Delete this user?')) {
            const delRes = await authFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
            if (delRes.ok) {
              loadAdminUsers();
            } else {
              const err = await delRes.json();
              alert(err.error || 'Failed to delete user');
            }
          }
        });
      });
    } catch (err) {
      console.error('Error loading admin users:', err);
    }
  }

  // Load Folders in Admin Console
  async function loadAdminFolders() {
    try {
      const res = await authFetch('/api/folders');
      if (!res.ok) return;
      accessibleFolders = await res.json();

      // Render Admin Folders List
      adminFoldersList.innerHTML = '';
      allowedFoldersCheckboxList.innerHTML = '';

      accessibleFolders.forEach((f) => {
        // Render in folder list
        const row = document.createElement('div');
        row.className = 'folder-row';
        row.innerHTML = `
          <div class="folder-row-meta">
            <h5>📁 ${escapeHtml(f.name)} <code>/${escapeHtml(f.folderPath)}</code></h5>
            <p>${escapeHtml(f.description || 'No description')} • by @${escapeHtml(f.createdBy)}</p>
          </div>
          <div class="folder-row-actions">
            ${f.id !== 'f_general' ? `<button class="btn btn-sm btn-danger delete-folder-btn" data-id="${f.id}">Delete</button>` : ''}
          </div>
        `;
        adminFoldersList.appendChild(row);

        // Render checkbox in create user form
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        label.innerHTML = `
          <input type="checkbox" name="allowedFolders" value="${f.id}">
          <span>📁 ${escapeHtml(f.name)}</span>
        `;
        allowedFoldersCheckboxList.appendChild(label);
      });

      document.querySelectorAll('.delete-folder-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const folderId = e.target.getAttribute('data-id');
          if (confirm('Delete this folder? Existing files will remain on disk.')) {
            const delRes = await authFetch(`/api/folders/${folderId}`, { method: 'DELETE' });
            if (delRes.ok) {
              loadAdminFolders();
              populateFolderSelectors();
            } else {
              const err = await delRes.json();
              alert(err.error || 'Failed to delete folder');
            }
          }
        });
      });

      populateFolderSelectors();
    } catch (err) {
      console.error('Error loading admin folders:', err);
    }
  }

  // Create User Form Handler
  createUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = newUsername.value.trim();
    const password = newPassword.value;
    const role = newRole.value;

    const checkedFolders = [];
    document
      .querySelectorAll('input[name="allowedFolders"]:checked')
      .forEach((cb) => checkedFolders.push(cb.value));

    try {
      const res = await authFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          role,
          allowedFolderIds: checkedFolders,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');

      alert(`✅ User "@${username}" created successfully!`);
      createUserForm.reset();
      loadAdminUsers();
    } catch (err) {
      alert(`Error creating user: ${err.message}`);
    }
  });

  // Create Folder Form Handler
  createFolderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newFolderName.value.trim();
    const description = newFolderDesc.value.trim();

    try {
      const res = await authFetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create folder');

      alert(`✅ Folder "${name}" created successfully!`);
      createFolderForm.reset();
      loadAdminFolders();
    } catch (err) {
      alert(`Error creating folder: ${err.message}`);
    }
  });

  // Utilities
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function escapeHtml(str) {
    return String(str || '').replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])
    );
  }

  // Kickoff Authentication Check
  checkAuth();
});
