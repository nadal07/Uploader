const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createUploaderRouter } = require('../lib/uploader-server');
const express = require('express');

async function runTests() {
  console.log('🧪 Starting Uploader Automated Verification Suite...\n');

  // Setup temporary test server instance
  const app = express();
  const PORT = 3099;
  const testStorageDir = path.join(__dirname, 'test_uploads');

  app.use('/api', createUploaderRouter({ storageDir: testStorageDir }));
  
  const server = app.listen(PORT);
  const baseUrl = `http://localhost:${PORT}/api`;

  try {
    // Step 1: Create 25MB synthetic binary file buffer (5 x 5MB chunks)
    console.log('1️⃣ Generating 25MB synthetic test payload (5MB chunks)...');
    const fileSize = 25 * 1024 * 1024; // 25 MB
    const chunkSize = 5 * 1024 * 1024;  // 5 MB
    const originalBuffer = crypto.randomBytes(fileSize);
    const originalHash = crypto.createHash('sha256').update(originalBuffer).digest('hex');

    console.log(`   - Original File Size: ${fileSize} bytes`);
    console.log(`   - Original SHA-256: ${originalHash}\n`);

    // Step 2: Test /api/init endpoint
    console.log('2️⃣ Testing POST /api/init endpoint...');
    const initPayload = JSON.stringify({
      filename: 'sample_test_video.mp4',
      filesize: fileSize,
      chunksize: chunkSize,
      filehash: originalHash,
    });

    const initRes = await httpRequest(`${baseUrl}/init`, 'POST', { 'Content-Type': 'application/json' }, initPayload);
    const initData = JSON.parse(initRes.body);

    if (initRes.statusCode !== 200 || !initData.uploadId) {
      throw new Error(`Init failed: status ${initRes.statusCode}, body: ${initRes.body}`);
    }

    const { uploadId, totalChunks } = initData;
    console.log(`   - Upload ID: ${uploadId}`);
    console.log(`   - Total Chunks Expected: ${totalChunks} (5MB each)\n`);

    // Step 3: Test POST /api/chunk endpoint for each chunk
    console.log('3️⃣ Uploading chunks sequentially via POST /api/chunk...');
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, fileSize);
      const chunkBuffer = originalBuffer.subarray(start, end);

      const chunkRes = await httpRequest(
        `${baseUrl}/chunk`,
        'POST',
        {
          'Content-Type': 'application/octet-stream',
          'x-upload-id': uploadId,
          'x-chunk-index': i.toString(),
        },
        chunkBuffer
      );

      if (chunkRes.statusCode !== 200) {
        throw new Error(`Chunk ${i} upload failed with status ${chunkRes.statusCode}: ${chunkRes.body}`);
      }

      console.log(`   - Uploaded Chunk ${i + 1}/${totalChunks} (${chunkBuffer.length} bytes) - HTTP 200 OK`);
    }

    // Step 4: Check Session Status
    console.log('\n4️⃣ Testing GET /api/status/:uploadId...');
    const statusRes = await httpRequest(`${baseUrl}/status/${uploadId}`, 'GET');
    const statusData = JSON.parse(statusRes.body);
    console.log(`   - Status uploaded chunks count: ${statusData.uploadedChunks.length}/${totalChunks}`);

    if (statusData.uploadedChunks.length !== totalChunks) {
      throw new Error('Status count mismatch');
    }

    // Step 5: Test POST /api/complete reassembly
    console.log('\n5️⃣ Testing POST /api/complete chunk stream merge...');
    const completeRes = await httpRequest(
      `${baseUrl}/complete`,
      'POST',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ uploadId })
    );

    const completeData = JSON.parse(completeRes.body);
    if (completeRes.statusCode !== 200 || !completeData.success) {
      throw new Error(`Complete failed: ${completeRes.body}`);
    }

    const fileRecord = completeData.file;
    console.log(`   - Merged File ID: ${fileRecord.fileId}`);
    console.log(`   - Stored File Name: ${fileRecord.storedName}`);

    // Step 6: Verify Hash Integrity of Merged File
    console.log('\n6️⃣ Verifying file hash integrity on disk...');
    const mergedFilePath = path.join(testStorageDir, fileRecord.storedName);
    const mergedBuffer = fs.readFileSync(mergedFilePath);
    const mergedHash = crypto.createHash('sha256').update(mergedBuffer).digest('hex');

    console.log(`   - Merged File Size: ${mergedBuffer.length} bytes`);
    console.log(`   - Merged SHA-256:   ${mergedHash}`);

    if (mergedHash !== originalHash) {
      throw new Error('❌ MERGED HASH DOES NOT MATCH ORIGINAL HASH!');
    }
    console.log('   - ✅ Hash Integrity Verified! 100% Exact Bit-for-Bit Match.');

    // Step 7: Test HTTP 206 Range Request Video Streaming
    console.log('\n7️⃣ Testing GET /api/stream/:fileId with HTTP Range Header (bytes=1048576-2097151)...');
    const rangeRes = await httpRequest(`${baseUrl}/stream/${fileRecord.fileId}`, 'GET', {
      Range: 'bytes=1048576-2097151',
    });

    console.log(`   - Response Status Code: ${rangeRes.statusCode} (Expected: 206)`);
    console.log(`   - Content-Range Header: ${rangeRes.headers['content-range']}`);
    console.log(`   - Content-Length Header: ${rangeRes.headers['content-length']}`);

    if (rangeRes.statusCode !== 206) {
      throw new Error(`Expected HTTP status 206, got ${rangeRes.statusCode}`);
    }
    if (parseInt(rangeRes.headers['content-length'], 10) !== 1048576) {
      throw new Error(`Expected Content-Length 1048576, got ${rangeRes.headers['content-length']}`);
    }
    console.log('   - ✅ HTTP 206 Partial Content Video Range Request Succeeded!');

    console.log('\n=======================================================');
    console.log('🎉 ALL AUTOMATED TESTS PASSED SUCCESSFULLY! (100% PASS)');
    console.log('=======================================================\n');
  } finally {
    server.close();
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  }
}

function httpRequest(url, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: headers,
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

runTests().catch((err) => {
  console.error('❌ Test suite failed with error:', err);
  process.exit(1);
});
