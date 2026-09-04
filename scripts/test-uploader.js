const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createUploaderRouter } = require('../lib/uploader-server');
const express = require('express');

async function runTests() {
  console.log('🧪 Starting Multi-User Folder Access Control & Permission Test Suite...\n');

  const app = express();
  const PORT = 3099;
  const testStorageDir = path.join(__dirname, 'test_acl_uploads');
  const folderAPath = path.join(__dirname, 'system_folder_a');
  const folderBPath = path.join(__dirname, 'system_folder_b');

  if (fs.existsSync(testStorageDir)) fs.rmSync(testStorageDir, { recursive: true, force: true });
  if (fs.existsSync(folderAPath)) fs.rmSync(folderAPath, { recursive: true, force: true });
  if (fs.existsSync(folderBPath)) fs.rmSync(folderBPath, { recursive: true, force: true });

  fs.mkdirSync(folderAPath, { recursive: true });
  fs.mkdirSync(folderBPath, { recursive: true });

  app.use('/api', createUploaderRouter({ storageDir: testStorageDir }));

  const server = app.listen(PORT);
  const baseUrl = `http://localhost:${PORT}/api`;

  try {
    // 1. Admin logs in
    console.log('1️⃣ Admin login...');
    const adminLoginRes = await httpRequest(
      `${baseUrl}/auth/login`,
      'POST',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ username: 'admin', password: 'admin123' })
    );
    const adminToken = JSON.parse(adminLoginRes.body).token;
    console.log('   - ✅ Admin logged in.');

    // 2. Admin creates two separate system folders
    console.log('\n2️⃣ Admin creates two distinct physical folders on the system:');
    console.log(`   - Folder A: ${folderAPath}`);
    console.log(`   - Folder B: ${folderBPath}`);

    const resA = await httpRequest(
      `${baseUrl}/folders`,
      'POST',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      JSON.stringify({ name: 'Confidential Projects', systemPath: folderAPath })
    );
    const folderA = JSON.parse(resA.body).folder;

    const resB = await httpRequest(
      `${baseUrl}/folders`,
      'POST',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      JSON.stringify({ name: 'Public Media', systemPath: folderBPath })
    );
    const folderB = JSON.parse(resB.body).folder;
    console.log(`   - ✅ Created: "${folderA.name}" (ID: ${folderA.id}) and "${folderB.name}" (ID: ${folderB.id})`);

    // 3. Admin creates User A (only Folder A) and User B (only Folder B)
    console.log('\n3️⃣ Admin creates two users with isolated folder permissions:');
    const resUserA = await httpRequest(
      `${baseUrl}/admin/users`,
      'POST',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      JSON.stringify({ username: 'usera', password: 'password123', role: 'user', allowedFolderIds: [folderA.id] })
    );
    const userA = JSON.parse(resUserA.body).user;
    console.log(`   - User "usera" granted access ONLY to: ["${folderA.name}"]`);

    const resUserB = await httpRequest(
      `${baseUrl}/admin/users`,
      'POST',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      JSON.stringify({ username: 'userb', password: 'password123', role: 'user', allowedFolderIds: [folderB.id] })
    );
    const userB = JSON.parse(resUserB.body).user;
    console.log(`   - User "userb" granted access ONLY to: ["${folderB.name}"]`);

    // 4. Log in as User A and verify accessible folders
    console.log('\n4️⃣ Verifying User A access:');
    const loginUserARes = await httpRequest(
      `${baseUrl}/auth/login`,
      'POST',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ username: 'usera', password: 'password123' })
    );
    const userAData = JSON.parse(loginUserARes.body);
    const userAToken = userAData.token;
    console.log(`   - User A sees ${userAData.accessibleFolders.length} folder(s): "${userAData.accessibleFolders[0].name}"`);
    if (userAData.accessibleFolders.some((f) => f.id === folderB.id)) {
      throw new Error('SECURITY VIOLATION: User A has unauthorized access to Folder B!');
    }
    console.log('   - ✅ Confirmed: User A cannot see Folder B.');

    // 5. Test User A attempting to upload to Folder B -> Expect 403 Forbidden
    console.log('\n5️⃣ Testing User A attempting to upload to Folder B (Unauthorized)...');
    const blockedRes = await httpRequest(
      `${baseUrl}/init`,
      'POST',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${userAToken}` },
      JSON.stringify({
        filename: 'secret_leak.mp4',
        filesize: 1048576,
        chunksize: 524288,
        folderId: folderB.id,
      })
    );
    console.log(`   - Response Status: ${blockedRes.statusCode} (Expected: 403 Forbidden)`);
    if (blockedRes.statusCode !== 403) {
      throw new Error(`Expected 403 Forbidden, but got ${blockedRes.statusCode}`);
    }
    console.log('   - ✅ Confirmed: Server strictly rejected unauthorized upload with 403 Forbidden!');

    // 6. User A successfully uploads to Folder A
    console.log('\n6️⃣ Testing User A uploading 10MB file to authorized Folder A...');
    const fileSize = 10 * 1024 * 1024;
    const chunkSize = 5 * 1024 * 1024;
    const sampleBuffer = crypto.randomBytes(fileSize);
    const sampleHash = crypto.createHash('sha256').update(sampleBuffer).digest('hex');

    const initA = await httpRequest(
      `${baseUrl}/init`,
      'POST',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${userAToken}` },
      JSON.stringify({
        filename: 'usera_project.mp4',
        filesize: fileSize,
        chunksize: chunkSize,
        filehash: sampleHash,
        folderId: folderA.id,
      })
    );
    const uploadIdA = JSON.parse(initA.body).uploadId;

    // Upload chunks
    for (let i = 0; i < 2; i++) {
      const start = i * chunkSize;
      const end = start + chunkSize;
      await httpRequest(
        `${baseUrl}/chunk`,
        'POST',
        {
          'Content-Type': 'application/octet-stream',
          'x-upload-id': uploadIdA,
          'x-chunk-index': i.toString(),
          Authorization: `Bearer ${userAToken}`,
        },
        sampleBuffer.subarray(start, end)
      );
    }

    const completeA = await httpRequest(
      `${baseUrl}/complete`,
      'POST',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${userAToken}` },
      JSON.stringify({ uploadId: uploadIdA })
    );
    const fileARecord = JSON.parse(completeA.body).file;
    console.log(`   - ✅ Upload complete: saved directly at ${fileARecord.fullPath}`);

    // 7. Dynamic Permission Grant: Admin grants User A access to Folder B
    console.log('\n7️⃣ Admin dynamically GRANTS User A access to Folder B (PUT /api/admin/users/:userId)...');
    const updatePermsRes = await httpRequest(
      `${baseUrl}/admin/users/${userA.id}`,
      'PUT',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      JSON.stringify({ allowedFolderIds: [folderA.id, folderB.id] })
    );
    console.log(`   - ✅ User A permissions updated: [${JSON.parse(updatePermsRes.body).user.allowedFolderIds.join(', ')}]`);

    // Verify User A can now upload to Folder B
    console.log('\n8️⃣ Verifying User A can now upload to Folder B after admin permission grant...');
    const allowedInitRes = await httpRequest(
      `${baseUrl}/init`,
      'POST',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${userAToken}` },
      JSON.stringify({
        filename: 'usera_now_allowed.mp4',
        filesize: 1048576,
        chunksize: 524288,
        folderId: folderB.id,
      })
    );
    console.log(`   - Response Status: ${allowedInitRes.statusCode} (Expected: 200 OK)`);
    if (allowedInitRes.statusCode !== 200) {
      throw new Error(`Expected 200 OK after permission grant, got ${allowedInitRes.statusCode}`);
    }
    console.log('   - ✅ Confirmed: User A now successfully initialized upload to Folder B!');

    // 9. Dynamic Permission Revoke: Admin revokes User A access from Folder B via Folder Access endpoint
    console.log('\n9️⃣ Admin dynamically REVOKES User A from Folder B (PUT /api/folders/:folderId/users)...');
    await httpRequest(
      `${baseUrl}/folders/${folderB.id}/users`,
      'PUT',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      JSON.stringify({ userIds: [userB.id] }) // Only userb remains
    );

    // Verify User A is immediately blocked from Folder B again
    const reblockedRes = await httpRequest(
      `${baseUrl}/init`,
      'POST',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${userAToken}` },
      JSON.stringify({
        filename: 'usera_blocked_again.mp4',
        filesize: 1048576,
        chunksize: 524288,
        folderId: folderB.id,
      })
    );
    console.log(`   - Response Status after revoke: ${reblockedRes.statusCode} (Expected: 403 Forbidden)`);
    if (reblockedRes.statusCode !== 403) {
      throw new Error(`Expected 403 Forbidden after revoke, got ${reblockedRes.statusCode}`);
    }
    console.log('   - ✅ Confirmed: User A is immediately blocked with 403 Forbidden after permission revoke!');

    console.log('\n======================================================================');
    console.log('🎉 ALL MULTI-USER FOLDER PERMISSION TESTS PASSED! (100% PASS)');
    console.log('======================================================================\n');
  } finally {
    server.close();
    if (fs.existsSync(testStorageDir)) fs.rmSync(testStorageDir, { recursive: true, force: true });
    if (fs.existsSync(folderAPath)) fs.rmSync(folderAPath, { recursive: true, force: true });
    if (fs.existsSync(folderBPath)) fs.rmSync(folderBPath, { recursive: true, force: true });
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
