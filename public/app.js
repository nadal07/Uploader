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
  const newFolderSystemPath = document.getElementById('newFolderSystemPath');
  const newFolderDesc = document.getElementById('newFolderDesc');
  const adminFoldersList = document.getElementById('adminFoldersList');

  // Elements - Permission Editor Modal
  const permissionModal = document.getElementById('permissionModal');
  const permissionModalTitle = document.getElementById('permissionModalTitle');
  const permissionModalSubtitle = document.getElementById('permissionModalSubtitle');
  const permissionCheckboxesList = document.getElementById('permissionCheckboxesList');
  const savePermissionsBtn = document.getElementById('savePermissionsBtn');
  const cancelPermissionBtn = document.getElementById('cancelPermissionBtn');
  const closePermissionModalBtn = document.getElementById('closePermissionModalBtn');

  // Elements - Change Password Prompt Modal (First-Login)
  const changePasswordModal = document.getElementById('changePasswordModal');
  const changePasswordModalTitle = document.getElementById('changePasswordModalTitle');
  const changePasswordModalSubtitle = document.getElementById('changePasswordModalSubtitle');
  const closeChangePasswordModalBtn = document.getElementById('closeChangePasswordModalBtn');
  const changePasswordForm = document.getElementById('changePasswordForm');
  const promptNewPassword = document.getElementById('promptNewPassword');
  const promptConfirmPassword = document.getElementById('promptConfirmPassword');
  const changePasswordErrorMsg = document.getElementById('changePasswordErrorMsg');
  const skipPasswordBtn = document.getElementById('skipPasswordBtn');

  // Elements - Admin Reset Password Modal
  const adminResetPasswordModal = document.getElementById('adminResetPasswordModal');
  const adminResetPasswordTitle = document.getElementById('adminResetPasswordTitle');
  const closeAdminResetPasswordBtn = document.getElementById('closeAdminResetPasswordBtn');
  const adminResetPasswordForm = document.getElementById('adminResetPasswordForm');
  const adminNewUserPassword = document.getElementById('adminNewUserPassword');
  const adminRequireChangeCheckbox = document.getElementById('adminRequireChangeCheckbox');
  const adminResetPasswordErrorMsg = document.getElementById('adminResetPasswordErrorMsg');
  const cancelAdminResetPasswordBtn = document.getElementById('cancelAdminResetPasswordBtn');

  let adminResetTargetUserId = null;
  let adminResetTargetUsername = null;

  let adminUsersCache = [];
  let permissionContext = { type: null, targetId: null, targetName: null };

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

    // Check if user is required or recommended to change their password
    if (user.mustChangePassword) {
      promptChangePassword(user);
    }
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
      adminUsersCache = users;

      adminUsersList.innerHTML = '';
      users.forEach((u) => {
        const row = document.createElement('div');
        row.className = 'user-row';

        let foldersHtml = '';
        if (u.role === 'admin' || (u.allowedFolderIds && u.allowedFolderIds.includes('*'))) {
          foldersHtml = '<span class="role-badge admin">All Folders (Admin)</span>';
        } else if (u.allowedFolderIds && u.allowedFolderIds.length > 0) {
          const tags = u.allowedFolderIds
            .map((id) => {
              const f = accessibleFolders.find((folder) => folder.id === id);
              return `<span class="file-tag">📁 ${escapeHtml(f ? f.name : id)}</span>`;
            })
            .join(' ');
          foldersHtml = `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">${tags}</div>`;
        } else {
          foldersHtml = '<span class="folder-note" style="color:#f87171;">⚠️ No folders assigned</span>';
        }

        row.innerHTML = `
          <div class="user-row-meta">
            <h5>${escapeHtml(u.username)} <span class="role-badge ${u.role}">${u.role}</span></h5>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Folder Access: ${foldersHtml}</div>
          </div>
          <div class="user-row-actions">
            ${u.role !== 'admin' ? `<button class="btn btn-sm btn-secondary edit-access-btn" data-id="${u.id}" data-username="${escapeHtml(u.username)}">📁 Access</button>` : ''}
            <button class="btn btn-sm btn-secondary reset-user-pass-btn" data-id="${u.id}" data-username="${escapeHtml(u.username)}" title="Reset password for this user">🔑 Password</button>
            ${u.username !== 'admin' ? `<button class="btn btn-sm btn-danger delete-user-btn" data-id="${u.id}">Delete</button>` : '<span class="folder-note">Protected</span>'}
          </div>
        `;
        adminUsersList.appendChild(row);
      });

      // Reset user password by Admin
      document.querySelectorAll('.reset-user-pass-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const userId = e.currentTarget.getAttribute('data-id');
          const username = e.currentTarget.getAttribute('data-username');
          openAdminResetPasswordModal(userId, username);
        });
      });

      // Edit user folder access
      document.querySelectorAll('.edit-access-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const userId = e.currentTarget.getAttribute('data-id');
          const username = e.currentTarget.getAttribute('data-username');
          openUserPermissionsModal(userId, username);
        });
      });

      document.querySelectorAll('.delete-user-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const userId = e.currentTarget.getAttribute('data-id');
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
        // Calculate assigned users
        const assignedUsers = adminUsersCache.filter(
          (u) =>
            u.role !== 'admin' &&
            u.allowedFolderIds &&
            u.allowedFolderIds.includes(f.id)
        );
        const usersSummary =
          assignedUsers.length > 0
            ? assignedUsers.map((u) => `@${escapeHtml(u.username)}`).join(', ')
            : '<span class="folder-note">Admin only</span>';

        // Render in folder list
        const row = document.createElement('div');
        row.className = 'folder-row';
        row.innerHTML = `
          <div class="folder-row-meta">
            <h5>📁 ${escapeHtml(f.name)}</h5>
            <p><code>${escapeHtml(f.systemPath || f.folderPath)}</code></p>
            <p style="margin-top:2px;"><strong>👥 Users:</strong> ${usersSummary}</p>
          </div>
          <div class="folder-row-actions">
            <button class="btn btn-sm btn-secondary manage-folder-users-btn" data-id="${f.id}" data-name="${escapeHtml(f.name)}" title="Manage which users can access this folder">👥 Access</button>
            <button class="btn btn-sm btn-secondary scan-folder-btn" data-id="${f.id}" title="Scan for files already on disk">🔍 Scan</button>
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

      // Manage folder access button listeners
      document.querySelectorAll('.manage-folder-users-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const folderId = e.currentTarget.getAttribute('data-id');
          const folderName = e.currentTarget.getAttribute('data-name');
          openFolderPermissionsModal(folderId, folderName);
        });
      });

      // Scan folder button listeners
      document.querySelectorAll('.scan-folder-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const folderId = e.currentTarget.getAttribute('data-id');
          btn.disabled = true;
          btn.textContent = 'Scanning...';
          try {
            const res = await authFetch(`/api/folders/${folderId}/scan`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
              alert(`🔍 Scan Complete: ${data.totalFound} items found on disk, ${data.newlyDiscovered} newly indexed!`);
              loadFiles();
            } else {
              alert(data.error || 'Scan failed');
            }
          } catch (err) {
            alert(`Scan error: ${err.message}`);
          } finally {
            btn.disabled = false;
            btn.textContent = '🔍 Scan';
          }
        });
      });

      document.querySelectorAll('.delete-folder-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const folderId = e.currentTarget.getAttribute('data-id');
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

  // ==========================================
  // PERMISSION EDITOR MODAL LOGIC
  // ==========================================
  function openUserPermissionsModal(userId, username) {
    permissionContext = { type: 'user', targetId: userId, targetName: username };
    permissionModalTitle.textContent = `🔑 Folder Access for @${username}`;
    permissionModalSubtitle.textContent = `Select which folders @${username} can view and upload to:`;

    const targetUser = adminUsersCache.find((u) => u.id === userId);
    const userFolderSet = new Set((targetUser && targetUser.allowedFolderIds) || []);

    permissionCheckboxesList.innerHTML = '';
    if (accessibleFolders.length === 0) {
      permissionCheckboxesList.innerHTML = '<p class="folder-note">No folders exist yet. Create a folder first.</p>';
    } else {
      accessibleFolders.forEach((f) => {
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        label.style.padding = '6px 8px';
        label.style.borderRadius = '4px';
        const isChecked = userFolderSet.has(f.id);
        label.innerHTML = `
          <input type="checkbox" name="permItem" value="${f.id}" ${isChecked ? 'checked' : ''}>
          <span>📁 <strong>${escapeHtml(f.name)}</strong> <small style="color:var(--text-muted); font-size:0.75rem;">(${escapeHtml(f.systemPath || f.folderPath)})</small></span>
        `;
        permissionCheckboxesList.appendChild(label);
      });
    }

    permissionModal.classList.remove('hidden');
  }

  function openFolderPermissionsModal(folderId, folderName) {
    permissionContext = { type: 'folder', targetId: folderId, targetName: folderName };
    permissionModalTitle.textContent = `👥 User Access for "${folderName}"`;
    permissionModalSubtitle.textContent = `Select which users can view and upload to this folder:`;

    const regularUsers = adminUsersCache.filter((u) => u.role !== 'admin');

    permissionCheckboxesList.innerHTML = '';
    if (regularUsers.length === 0) {
      permissionCheckboxesList.innerHTML = '<p class="folder-note">No regular users created yet.</p>';
    } else {
      regularUsers.forEach((u) => {
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        label.style.padding = '6px 8px';
        label.style.borderRadius = '4px';
        const hasAccess = u.allowedFolderIds && u.allowedFolderIds.includes(folderId);
        label.innerHTML = `
          <input type="checkbox" name="permItem" value="${u.id}" ${hasAccess ? 'checked' : ''}>
          <span>👤 <strong>@${escapeHtml(u.username)}</strong></span>
        `;
        permissionCheckboxesList.appendChild(label);
      });
    }

    permissionModal.classList.remove('hidden');
  }

  // Save Permissions Button Handler
  savePermissionsBtn.addEventListener('click', async () => {
    savePermissionsBtn.disabled = true;
    savePermissionsBtn.textContent = 'Saving...';

    const selectedIds = [];
    document
      .querySelectorAll('input[name="permItem"]:checked')
      .forEach((cb) => selectedIds.push(cb.value));

    try {
      if (permissionContext.type === 'user') {
        const res = await authFetch(`/api/admin/users/${permissionContext.targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowedFolderIds: selectedIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update user permissions');

        alert(`✅ Folder access updated for @${permissionContext.targetName}!`);
      } else if (permissionContext.type === 'folder') {
        const res = await authFetch(`/api/folders/${permissionContext.targetId}/users`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: selectedIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update folder access');

        alert(`✅ User permissions updated for "${permissionContext.targetName}"!`);
      }

      permissionModal.classList.add('hidden');
      await loadAdminUsers();
      await loadAdminFolders();
      await loadFiles();
    } catch (err) {
      alert(`Error saving permissions: ${err.message}`);
    } finally {
      savePermissionsBtn.disabled = false;
      savePermissionsBtn.textContent = 'Save Permissions';
    }
  });

  closePermissionModalBtn.addEventListener('click', () => {
    permissionModal.classList.add('hidden');
  });

  cancelPermissionBtn.addEventListener('click', () => {
    permissionModal.classList.add('hidden');
  });

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
    const systemPath = newFolderSystemPath ? newFolderSystemPath.value.trim() : '';
    const description = newFolderDesc.value.trim();

    try {
      const res = await authFetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, systemPath, description }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create folder');

      alert(`✅ System Folder "${name}" created!\nPath: ${data.folder.systemPath}`);
      createFolderForm.reset();
      loadAdminFolders();
    } catch (err) {
      alert(`Error creating folder: ${err.message}`);
    }
  });

  // ==========================================
  // PASSWORD MANAGEMENT & PROMPTS
  // ==========================================
  function promptChangePassword(user) {
    changePasswordErrorMsg.classList.add('hidden');
    changePasswordErrorMsg.textContent = '';
    promptNewPassword.value = '';
    promptConfirmPassword.value = '';

    if (user.role === 'admin') {
      changePasswordModalTitle.textContent = '🔒 Mandatory: Set New Admin Password';
      changePasswordModalSubtitle.textContent = 'For security, you must change the default administrator password before accessing the system.';
      closeChangePasswordModalBtn.classList.add('hidden');
      skipPasswordBtn.classList.add('hidden');
    } else {
      changePasswordModalTitle.textContent = '🔒 Recommended: Set a Personal Password';
      changePasswordModalSubtitle.textContent = 'You are logged in with an initial password. Would you like to set your own password?';
      closeChangePasswordModalBtn.classList.remove('hidden');
      skipPasswordBtn.classList.remove('hidden');
    }

    changePasswordModal.classList.remove('hidden');
    promptNewPassword.focus();
  }

  // Handle self password change submission
  changePasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    changePasswordErrorMsg.classList.add('hidden');

    const newPass = promptNewPassword.value;
    const confirmPass = promptConfirmPassword.value;

    if (newPass !== confirmPass) {
      changePasswordErrorMsg.textContent = 'Passwords do not match.';
      changePasswordErrorMsg.classList.remove('hidden');
      return;
    }

    if (newPass.length < 4) {
      changePasswordErrorMsg.textContent = 'Password must be at least 4 characters.';
      changePasswordErrorMsg.classList.remove('hidden');
      return;
    }

    try {
      const res = await authFetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update password');

      if (currentUser) currentUser.mustChangePassword = false;
      changePasswordModal.classList.add('hidden');
      alert('✅ Your password has been updated successfully!');
    } catch (err) {
      changePasswordErrorMsg.textContent = err.message;
      changePasswordErrorMsg.classList.remove('hidden');
    }
  });

  // Handle regular user skipping password change
  skipPasswordBtn.addEventListener('click', async () => {
    try {
      await authFetch('/api/auth/skip-password-change', { method: 'POST' });
      if (currentUser) currentUser.mustChangePassword = false;
      changePasswordModal.classList.add('hidden');
    } catch (err) {
      alert(`Could not skip: ${err.message}`);
    }
  });

  closeChangePasswordModalBtn.addEventListener('click', () => {
    if (currentUser && currentUser.role !== 'admin') {
      changePasswordModal.classList.add('hidden');
    }
  });

  // Admin Reset Password Modal
  function openAdminResetPasswordModal(userId, username) {
    adminResetTargetUserId = userId;
    adminResetTargetUsername = username;
    adminResetPasswordTitle.textContent = `🔑 Change Password for @${username}`;
    adminResetPasswordSubtitle.textContent = `Set a new password for @${username}:`;
    adminNewUserPassword.value = '';
    adminRequireChangeCheckbox.checked = true;
    adminResetPasswordErrorMsg.classList.add('hidden');

    adminResetPasswordModal.classList.remove('hidden');
    adminNewUserPassword.focus();
  }

  adminResetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    adminResetPasswordErrorMsg.classList.add('hidden');

    const newPass = adminNewUserPassword.value;
    const requireChange = adminRequireChangeCheckbox.checked;

    if (!newPass || newPass.length < 4) {
      adminResetPasswordErrorMsg.textContent = 'Password must be at least 4 characters.';
      adminResetPasswordErrorMsg.classList.remove('hidden');
      return;
    }

    try {
      const res = await authFetch(`/api/admin/users/${adminResetTargetUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: newPass,
          mustChangePassword: requireChange,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update user password');

      adminResetPasswordModal.classList.add('hidden');
      alert(`✅ Password updated for user @${adminResetTargetUsername}!`);
      loadAdminUsers();
    } catch (err) {
      adminResetPasswordErrorMsg.textContent = err.message;
      adminResetPasswordErrorMsg.classList.remove('hidden');
    }
  });

  closeAdminResetPasswordBtn.addEventListener('click', () => {
    adminResetPasswordModal.classList.add('hidden');
  });

  cancelAdminResetPasswordBtn.addEventListener('click', () => {
    adminResetPasswordModal.classList.add('hidden');
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
