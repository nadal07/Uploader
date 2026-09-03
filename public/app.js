document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const configToggleBtn = document.getElementById('configToggleBtn');
  const settingsDrawer = document.getElementById('settingsDrawer');
  const chunkSizeSelect = document.getElementById('chunkSizeSelect');
  const concurrencySelect = document.getElementById('concurrencySelect');

  // Active Upload UI
  const activeUploadContainer = document.getElementById('activeUploadContainer');
  const uploadFileName = document.getElementById('uploadFileName');
  const uploadFileSize = document.getElementById('uploadFileSize');
  const progressBarFill = document.getElementById('progressBarFill');
  const statPercent = document.getElementById('statPercent');
  const statSpeed = document.getElementById('statSpeed');
  const statEta = document.getElementById('statEta');
  const statChunks = document.getElementById('statChunks');
  const chunkGrid = document.getElementById('chunkGrid');

  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const cancelBtn = document.getElementById('cancelBtn');

  // File Gallery
  const fileGrid = document.getElementById('fileGrid');
  const emptyState = document.getElementById('emptyState');
  const refreshFilesBtn = document.getElementById('refreshFilesBtn');

  // Video Stream Modal
  const videoModal = document.getElementById('videoModal');
  const modalVideoTitle = document.getElementById('modalVideoTitle');
  const videoPlayer = document.getElementById('videoPlayer');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const rangeLog = document.getElementById('rangeLog');

  let uploader = null;

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

  // Handle selected file upload initiation
  function handleSelectedFile(file) {
    const chunkSize = parseInt(chunkSizeSelect.value, 10);
    const concurrency = parseInt(concurrencySelect.value, 10);

    uploader = new UploaderClient({
      apiBaseUrl: '/api',
      chunkSize: chunkSize,
      concurrency: concurrency,
    });

    // Setup visual UI elements
    uploadFileName.textContent = file.name;
    uploadFileSize.textContent = formatBytes(file.size);
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
        alert(`🎉 Upload complete! File saved as "${result.fileRecord.originalName}"`);
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
    try {
      const response = await fetch('/api/files');
      if (!response.ok) return;
      const files = await response.json();

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

        fileCard.innerHTML = `
          <div class="file-item-left">
            <span class="file-icon">${icon}</span>
            <div class="file-details">
              <h4>${escapeHtml(file.originalName)}</h4>
              <p>${formatBytes(file.size)} • ${new Date(file.uploadedAt).toLocaleString()}</p>
            </div>
          </div>
          <div class="file-item-actions">
            ${isVideo ? `<button class="btn btn-sm btn-primary play-btn" data-id="${file.fileId}" data-title="${escapeHtml(file.originalName)}">Stream</button>` : ''}
            <a href="${file.downloadUrl}" class="btn btn-sm btn-secondary" download>Download</a>
            <button class="btn btn-sm btn-secondary copy-btn" data-url="${window.location.origin}${file.streamUrl}">Copy Link</button>
            <button class="btn btn-sm btn-danger delete-btn" data-id="${file.fileId}">Delete</button>
          </div>
        `;
        fileGrid.appendChild(fileCard);
      });

      // Event listeners for file card buttons
      document.querySelectorAll('.play-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const fileId = e.target.getAttribute('data-id');
          const title = e.target.getAttribute('data-title');
          openVideoModal(fileId, title);
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
            await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
            loadFiles();
          }
        });
      });
    } catch (err) {
      console.error('Error loading files:', err);
    }
  }

  refreshFilesBtn.addEventListener('click', loadFiles);

  // Open Video Stream Modal & Track Range Requests
  function openVideoModal(fileId, title) {
    modalVideoTitle.textContent = `Streaming: ${title}`;
    const streamUrl = `/api/stream/${fileId}`;
    videoPlayer.src = streamUrl;
    videoModal.classList.remove('hidden');
    videoPlayer.play();

    rangeLog.innerHTML = `[${new Date().toLocaleTimeString()}] Initialized video player. Requesting HTTP Range header bytes=0- ...`;

    // Debugger for video seeking & Range headers
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

  // Utility helpers
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }

  // Initial load
  loadFiles();
});
