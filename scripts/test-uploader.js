const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createUploaderRouter } = require('../lib/uploader-server');
const express = require('express');

async function runTests() {
  console.log('🧪 Starting Authentication & Folder Permission Verification Suite...\n');

  // Setup temporary test server instance
  const app = express();
  const PORT = 3099;
  const testStorageDir = path.join(__dirname, 'test_auth_uploads');

  if (fs.existsSync(testStorageDir)) {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  }

  app.use('/api', createUploaderRouter({ storageDir: testStorageDir }));

  const server = app.listen(PORT);
  const baseUrl = `http://localhost:${PORT}/api`;

  try {
    // Step 1: Test Admin Login with default bootstrap credentials
    console.log('1️⃣ Testing Admin Login (POST /api/auth/login)...');
    const adminLoginRes = await httpRequest(
      `${baseUrl}/auth/login`,
      'POST',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ username: 'admin', password: 'admin123' })
    );

    const adminLoginData = JSON.parse(adminLoginRes.body);
    if (adminLoginRes.statusCode !== 200 || !adminLoginData.token) {
      throw new Error(`Admin login failed: ${adminLoginRes.body}`);
    }
    const adminToken = adminLoginData.token;
    console.log(`   - ✅ Admin authenticated! Token acquired: ${adminToken.substring(0, 20)}...`);

    // Step 2: Admin creates a new folder
    console.log('\n2️⃣ Admin creates a new folder "vault" (POST /api/folders)...');
    const createFolderRes = await httpRequest(
      `${baseUrl}/folders`,
      'POST',
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      JSON.stringify({ name: 'Vault', description: 'Secure vault storage' })
    );

    const folderData = JSON.parse(createFolderRes.body);
    if (createFolderRes.statusCode !== 201 || !folderData.folder) {
      throw new Error(`Create folder failed: ${createFolderRes.body}`);
    }
    const vaultFolder = folderData.folder;
    console.log(`   - ✅ Created folder: "${vaultFolder.name}" (ID: ${vaultFolder.id}, Path: /${vaultFolder.folderPath})`);

    // Step 3: Admin creates a restricted user "alice" with access ONLY to "Vault"
    console.log('\n3️⃣ Admin creates restricted user "alice" with access ONLY to "Vault"...');
    const createUserRes = await httpRequest(
      `${baseUrl}/admin/users`,
      'POST',
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      JSON.stringify({
        username: 'alice',
        password: 'alicepassword',
        role: 'user',
        allowedFolderIds: [vaultFolder.id],
      })
    );

    const userData = JSON.parse(createUserRes.body);
    if (createUserRes.statusCode !== 201 || !userData.user) {
      throw new Error(`Create user failed: ${createUserRes.body}`);
    }
    console.log(`   - ✅ User "alice" created with allowedFolderIds: [${userData.user.allowedFolderIds.join(', ')}]`);

    // Step 4: Login as Alice
    console.log('\n4️⃣ Authenticating as "alice" (POST /api/auth/login)...');
    const aliceLoginRes = await httpRequest(
      `${baseUrl}/auth/login`,
      'POST',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ username: 'alice', password: 'alicepassword' })
    );

    const aliceData = JSON.parse(aliceLoginRes.body);
    if (aliceLoginRes.statusCode !== 200 || !aliceData.token) {
      throw new Error(`Alice login failed: ${aliceLoginRes.body}`);
    }
    const aliceToken = aliceData.token;
    console.log(`   - ✅ Alice authenticated! Accessible folders count: ${aliceData.accessibleFolders.length}`);

    // Step 5: Test Permission Enforcement - Alice attempts to upload to unauthorized folder "f_general"
    console.log('\n5️⃣ Testing Access Control: Alice attempts to upload to UNAUTHORIZED folder "f_general"...');
    const unauthInitRes = await httpRequest(
      `${baseUrl}/init`,
      'POST',
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      JSON.stringify({
        filename: 'unauthorized_file.mp4',
        filesize: 1048576,
        chunksize: 524288,
        folderId: 'f_general',
      })
    );

    console.log(`   - Response Status: ${unauthInitRes.statusCode} (Expected: 403 Forbidden)`);
    if (unauthInitRes.statusCode !== 403) {
      throw new Error(`Expected 403 Forbidden, but got ${unauthInitRes.statusCode}: ${unauthInitRes.body}`);
    }
    console.log('   - ✅ Security Verified: Unauthorized folder upload was strictly blocked (403)!');

    // Step 6: Alice uploads 25MB file to her AUTHORIZED folder "Vault"
    console.log('\n6️⃣ Alice uploads 25MB file to her AUTHORIZED folder "Vault" in 5MB chunks...');
    const fileSize = 25 * 1024 * 1024;
    const chunkSize = 5 * 1024 * 1024;
    const originalBuffer = crypto.randomBytes(fileSize);
    const originalHash = crypto.createHash('sha256').update(originalBuffer).digest('hex');

    const authInitRes = await httpRequest(
      `${baseUrl}/init`,
      'POST',
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      JSON.stringify({
        filename: 'alice_lecture_video.mp4',
        filesize: fileSize,
        chunksize: chunkSize,
        filehash: originalHash,
        folderId: vaultFolder.id,
      })
    );

    const initData = JSON.parse(authInitRes.body);
    if (authInitRes.statusCode !== 200 || !initData.uploadId) {
      throw new Error(`Authorized init failed: ${authInitRes.body}`);
    }
    const { uploadId, totalChunks } = initData;
    console.log(`   - Upload session initialized: ID ${uploadId}, ${totalChunks} chunks`);

    // Upload each chunk with Alice's token
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
          Authorization: `Bearer ${aliceToken}`,
        },
        chunkBuffer
      );

      if (chunkRes.statusCode !== 200) {
        throw new Error(`Chunk ${i} upload failed: ${chunkRes.body}`);
      }
      console.log(`   - Chunk ${i + 1}/${totalChunks} uploaded (${chunkBuffer.length} bytes) - OK`);
    }

    // Step 7: Complete upload and reassemble into target folder
    console.log('\n7️⃣ Completing upload and reassembling into target folder...');
    const completeRes = await httpRequest(
      `${baseUrl}/complete`,
      'POST',
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      JSON.stringify({ uploadId })
    );

    const completeData = JSON.parse(completeRes.body);
    if (completeRes.statusCode !== 200 || !completeData.success) {
      throw new Error(`Complete failed: ${completeRes.body}`);
    }

    const fileRecord = completeData.file;
    console.log(`   - File Record created: ${fileRecord.originalName} in folder "${fileRecord.folderName}"`);
    console.log(`   - Physical Path: uploads/${fileRecord.folderPath}/${fileRecord.storedName}`);

    // Verify file exists in physical folder directory and hash matches
    const expectedDiskPath = path.join(testStorageDir, vaultFolder.folderPath, fileRecord.storedName);
    if (!fs.existsSync(expectedDiskPath)) {
      throw new Error(`File missing at expected disk path: ${expectedDiskPath}`);
    }

    const savedBuffer = fs.readFileSync(expectedDiskPath);
    const savedHash = crypto.createHash('sha256').update(savedBuffer).digest('hex');
    if (savedHash !== originalHash) {
      throw new Error('Saved file hash mismatch!');
    }
    console.log('   - ✅ File correctly placed in folder directory with 100% SHA-256 Bit Match!');

    // Step 8: Authenticated HTTP 206 Range Streaming (via ?token= query parameter)
    console.log('\n8️⃣ Testing Authenticated Video Streaming with ?token= query param...');
    const streamRes = await httpRequest(
      `${baseUrl}/stream/${fileRecord.fileId}?token=${encodeURIComponent(aliceToken)}`,
      'GET',
      { Range: 'bytes=0-1048575' }
    );

    console.log(`   - Stream Status Code: ${streamRes.statusCode} (Expected: 206)`);
    console.log(`   - Content-Range: ${streamRes.headers['content-range']}`);
    console.log(`   - Content-Length: ${streamRes.headers['content-length']}`);

    if (streamRes.statusCode !== 206) {
      throw new Error(`Expected HTTP 206, got ${streamRes.statusCode}`);
    }
    console.log('   - ✅ Authenticated HTTP 206 Byte-Range Video Streaming Succeeded!');

    console.log('\n======================================================================');
    console.log('🎉 ALL AUTHENTICATION & FOLDER PERMISSION TESTS PASSED! (100% PASS)');
    console.log('======================================================================\n');
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
