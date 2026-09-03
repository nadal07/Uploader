/**
 * UploaderClient - Reusable browser JavaScript library for resumable, chunked file uploads over Cloudflare Tunnel
 */
class UploaderClient {
  /**
   * @param {Object} options Configuration options
   * @param {string} [options.apiBaseUrl='/api'] Base URL for the uploader endpoints
   * @param {number} [options.chunkSize=10485760] Chunk size in bytes (default 10MB, under Cloudflare limit)
   * @param {number} [options.concurrency=2] Number of parallel chunk uploads
   * @param {number} [options.maxRetries=4] Maximum retry attempts per failed chunk
   */
  constructor(options = {}) {
    this.apiBaseUrl = (options.apiBaseUrl || '/api').replace(/\/$/, '');
    this.chunkSize = options.chunkSize || 10 * 1024 * 1024; // Default 10MB
    this.concurrency = options.concurrency || 2;
    this.maxRetries = options.maxRetries || 4;

    this.file = null;
    this.uploadId = null;
    this.totalChunks = 0;
    this.uploadedChunks = new Set();
    this.chunkStates = []; // Array tracking state: 'pending', 'uploading', 'done', 'error'

    this.isPaused = false;
    this.isCancelled = false;
    this.isUploading = false;

    this.activeWorkerCount = 0;
    this.queue = [];
    this.retryCounts = new Map();

    // Speed calculation stats
    this.startTime = null;
    this.bytesUploadedSinceStart = 0;

    // Event listeners
    this.callbacks = {
      onInit: () => {},
      onProgress: () => {},
      onChunkSuccess: () => {},
      onChunkError: () => {},
      onPause: () => {},
      onResume: () => {},
      onComplete: () => {},
      onError: () => {},
    };
  }

  /**
   * Register event callbacks
   * @param {Object} callbacks
   */
  on(event, fn) {
    if (typeof fn === 'function') {
      const eventName = 'on' + event.charAt(0).toUpperCase() + event.slice(1);
      if (eventName in this.callbacks) {
        this.callbacks[eventName] = fn;
      }
    }
    return this;
  }

  /**
   * Start uploading a File object
   * @param {File} file
   */
  async start(file) {
    if (!file) throw new Error('File object is required');
    this.file = file;
    this.isPaused = false;
    this.isCancelled = false;
    this.isUploading = true;
    this.totalChunks = Math.ceil(file.size / this.chunkSize);
    this.chunkStates = new Array(this.totalChunks).fill('pending');
    this.startTime = Date.now();
    this.bytesUploadedSinceStart = 0;

    try {
      // Step 1: Initialize session on server
      const initResponse = await fetch(`${this.apiBaseUrl}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          filesize: file.size,
          chunksize: this.chunkSize,
          filehash: `${file.name}_${file.size}_${file.lastModified}`,
        }),
      });

      if (!initResponse.ok) {
        const errorText = await initResponse.text();
        throw new Error(`Init failed (${initResponse.status}): ${errorText}`);
      }

      const initData = await initResponse.json();
      this.uploadId = initData.uploadId;

      // Mark chunks that were already uploaded on server
      if (Array.isArray(initData.uploadedChunks)) {
        initData.uploadedChunks.forEach((idx) => {
          this.uploadedChunks.add(idx);
          this.chunkStates[idx] = 'done';
        });
      }

      this.callbacks.onInit({
        uploadId: this.uploadId,
        totalChunks: this.totalChunks,
        uploadedChunks: Array.from(this.uploadedChunks),
        filesize: file.size,
      });

      this.saveLocalState();

      // Check if already completed
      if (this.uploadedChunks.size === this.totalChunks) {
        await this.completeUpload();
        return;
      }

      // Populate upload queue with remaining pending chunk indices
      this.queue = [];
      for (let i = 0; i < this.totalChunks; i++) {
        if (!this.uploadedChunks.has(i)) {
          this.queue.push(i);
        }
      }

      // Trigger concurrent workers
      this.processQueue();
    } catch (err) {
      this.isUploading = false;
      this.callbacks.onError(err);
    }
  }

  /**
   * Process pending chunk upload queue
   */
  processQueue() {
    if (this.isPaused || this.isCancelled || !this.isUploading) return;

    while (this.activeWorkerCount < this.concurrency && this.queue.length > 0) {
      const chunkIndex = this.queue.shift();
      this.activeWorkerCount++;
      this.uploadChunk(chunkIndex);
    }
  }

  /**
   * Upload an individual chunk to the server
   * @param {number} chunkIndex
   */
  async uploadChunk(chunkIndex) {
    if (this.isPaused || this.isCancelled) {
      this.activeWorkerCount--;
      return;
    }

    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.file.size);
    const chunkBlob = this.file.slice(start, end);

    this.chunkStates[chunkIndex] = 'uploading';
    this.notifyProgress();

    try {
      const response = await fetch(`${this.apiBaseUrl}/chunk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-upload-id': this.uploadId,
          'x-chunk-index': chunkIndex.toString(),
        },
        body: chunkBlob,
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP status ${response.status}`);
      }

      // Success
      this.uploadedChunks.add(chunkIndex);
      this.chunkStates[chunkIndex] = 'done';
      this.bytesUploadedSinceStart += chunkBlob.size;
      this.retryCounts.delete(chunkIndex);

      this.callbacks.onChunkSuccess({
        uploadId: this.uploadId,
        chunkIndex,
        totalChunks: this.totalChunks,
      });

      this.saveLocalState();
      this.notifyProgress();

      // Check if all chunks completed
      if (this.uploadedChunks.size === this.totalChunks) {
        this.activeWorkerCount--;
        if (this.activeWorkerCount === 0) {
          await this.completeUpload();
        }
        return;
      }
    } catch (err) {
      console.warn(`Chunk ${chunkIndex} upload failed:`, err.message);
      const retries = (this.retryCounts.get(chunkIndex) || 0) + 1;
      this.retryCounts.set(chunkIndex, retries);

      this.callbacks.onChunkError({
        uploadId: this.uploadId,
        chunkIndex,
        error: err.message,
        retryCount: retries,
      });

      if (retries <= this.maxRetries) {
        // Re-queue chunk after exponential backoff delay
        const delay = Math.min(1000 * Math.pow(2, retries - 1), 8000);
        setTimeout(() => {
          if (!this.isPaused && !this.isCancelled) {
            this.queue.push(chunkIndex);
            this.processQueue();
          }
        }, delay);
      } else {
        this.chunkStates[chunkIndex] = 'error';
        this.isUploading = false;
        this.callbacks.onError(
          new Error(`Chunk ${chunkIndex} failed after ${this.maxRetries} retries: ${err.message}`)
        );
      }
    } finally {
      this.activeWorkerCount--;
      this.processQueue();
    }
  }

  /**
   * Signal server to merge chunks into final file
   */
  async completeUpload() {
    try {
      this.isUploading = false;
      const response = await fetch(`${this.apiBaseUrl}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: this.uploadId }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Complete failed (${response.status}): ${errText}`);
      }

      const result = await response.json();
      this.clearLocalState();
      this.callbacks.onComplete({
        uploadId: this.uploadId,
        fileRecord: result.file,
      });
    } catch (err) {
      this.callbacks.onError(err);
    }
  }

  /**
   * Pause upload
   */
  pause() {
    if (!this.isUploading || this.isPaused) return;
    this.isPaused = true;
    this.isUploading = false;
    this.callbacks.onPause({ uploadId: this.uploadId });
  }

  /**
   * Resume upload
   */
  resume() {
    if (!this.isPaused || !this.file) return;
    this.isPaused = false;
    this.isUploading = true;
    this.startTime = Date.now();
    this.bytesUploadedSinceStart = 0;
    this.callbacks.onResume({ uploadId: this.uploadId });

    // Re-populate queue for pending/failed chunks
    this.queue = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.uploadedChunks.has(i)) {
        this.queue.push(i);
        this.chunkStates[i] = 'pending';
      }
    }

    this.processQueue();
  }

  /**
   * Cancel upload
   */
  cancel() {
    this.isCancelled = true;
    this.isUploading = false;
    this.isPaused = false;
    this.queue = [];
    this.clearLocalState();
  }

  /**
   * Calculate upload progress, speed, and ETA
   */
  notifyProgress() {
    let loadedBytes = 0;
    for (let i = 0; i < this.totalChunks; i++) {
      if (this.uploadedChunks.has(i)) {
        const start = i * this.chunkSize;
        const end = Math.min(start + this.chunkSize, this.file.size);
        loadedBytes += end - start;
      }
    }

    const percent = Math.min(100, (loadedBytes / this.file.size) * 100);
    const elapsedSec = (Date.now() - (this.startTime || Date.now())) / 1000;
    const speed = elapsedSec > 0 ? this.bytesUploadedSinceStart / elapsedSec : 0; // bytes/sec
    const remainingBytes = this.file.size - loadedBytes;
    const eta = speed > 0 ? remainingBytes / speed : 0; // seconds

    this.callbacks.onProgress({
      uploadId: this.uploadId,
      loaded: loadedBytes,
      total: this.file.size,
      percent: Number(percent.toFixed(1)),
      speedBytesPerSec: Math.round(speed),
      etaSec: Math.round(eta),
      chunkStates: [...this.chunkStates],
    });
  }

  /**
   * Local state persistence helpers for auto recovery
   */
  saveLocalState() {
    if (!this.uploadId || !this.file) return;
    try {
      const stateKey = `uploader_session_${this.file.name}_${this.file.size}`;
      localStorage.setItem(
        stateKey,
        JSON.stringify({
          uploadId: this.uploadId,
          filename: this.file.name,
          filesize: this.file.size,
          lastUpdated: Date.now(),
        })
      );
    } catch (e) {
      // Ignore localStorage errors
    }
  }

  clearLocalState() {
    if (!this.file) return;
    try {
      const stateKey = `uploader_session_${this.file.name}_${this.file.size}`;
      localStorage.removeItem(stateKey);
    } catch (e) {}
  }
}

// Export for ES Module, CommonJS, and Window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UploaderClient;
}
if (typeof window !== 'undefined') {
  window.UploaderClient = UploaderClient;
}
