const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createDrive } = require('../src/highlights/drive');

const env = { GOOGLE_DRIVE_FOLDER_ID: 'private-folder', GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REFRESH_TOKEN: 'test-refresh' };
const privateFolder = { mimeType: 'application/vnd.google-apps.folder', permissions: [{ type: 'user' }] };
const job = { videoId: 'replay00001' };
const clip = { id: 't0' };
const signal = () => new AbortController().signal;
const json = body => new Response(JSON.stringify(body), { status: 200 });

function mockRequests(t, responses) {
    const calls = [];
    t.mock.method(global, 'fetch', async (url, options) => {
        calls.push({ url, options });
        assert.ok(responses.length, 'Unexpected additional request');
        return responses.shift();
    });
    return calls;
}

async function localClip(t, size) {
    const directory = await mkdtemp(join(tmpdir(), 'iona-drive-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'clip.mp4');
    await writeFile(path, Buffer.alloc(size));
    return path;
}

test('Drive upload sends bounded chunks and returns the confirmed file ID', async t => {
    // Slightly exceed one chunk so the upload must handle a 308 continuation response.
    const chunkSize = 8 * 1024 * 1024;
    const bytes = chunkSize + 3;
    const path = await localClip(t, bytes);
    const calls = mockRequests(t, [json({ access_token: 'test-access' }), json(privateFolder), json({ files: [] }),
        new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } }),
        new Response(null, { status: 308 }), json({ id: 'uploaded-file' })]);
    const upload = await createDrive(env, signal());

    assert.equal(await upload(job, clip, path), 'uploaded-file');

    // The session has private folder metadata, while chunk ranges cover exactly the local file.
    assert.deepEqual(JSON.parse(calls[3].options.body), {
        name: 'replay00001-t0.mp4', parents: ['private-folder'], appProperties: { ionaClip: 'replay00001-t0' },
    });
    const chunks = calls.filter(call => call.options.method === 'PUT');
    assert.deepEqual(chunks.map(call => call.options.headers['Content-Range']), [
        `bytes 0-${chunkSize - 1}/${bytes}`, `bytes ${chunkSize}-${bytes - 1}/${bytes}`,
    ]);
    assert.deepEqual(chunks.map(call => call.options.body.length), [chunkSize, 3]);
});

test('Drive restart recovery reuses an existing upload without opening the local file', async t => {
    const calls = mockRequests(t, [json({ access_token: 'test-access' }), json(privateFolder), json({ files: [{ id: 'saved-file' }] })]);
    const upload = await createDrive(env, signal());

    // The file need not exist when a previous attempt already completed the upload.
    assert.equal(await upload(job, clip, 'missing-clip.mp4'), 'saved-file');
    assert.equal(calls.length, 3);
    const query = new URL(calls[2].url).searchParams.get('q');
    assert.match(query, /value='replay00001-t0'/);
    assert.match(query, /'private-folder' in parents/);
});

test('Drive initialization rejects destinations whose privacy cannot be verified', async t => {
    const invalidFolders = [
        { name: 'regular file', folder: { mimeType: 'video/mp4' }, error: /not a folder/ },
        { name: 'missing permissions', folder: { mimeType: privateFolder.mimeType }, error: /verify/ },
        { name: 'public folder', folder: { ...privateFolder, permissions: [{ type: 'anyone' }] }, error: /private/ },
        { name: 'domain folder', folder: { ...privateFolder, permissions: [{ type: 'domain' }] }, error: /private/ },
    ];
    for (const example of invalidFolders) {
        await t.test(example.name, async t => {
            const calls = mockRequests(t, [json({ access_token: 'test-access' }), json(example.folder)]);
            await assert.rejects(createDrive(env, signal()), example.error);
            // No upload session or sharing change is attempted for a rejected destination.
            assert.equal(calls.length, 2);
        });
    }
});

test('Drive upload rejects failed sessions, untrusted locations and failed chunks without claiming success', async t => {
    const failures = [
        { name: 'session failure', responses: [new Response(null, { status: 503 })], error: /session failed/ },
        { name: 'untrusted location', responses: [new Response(null, { headers: { location: 'https://example.com/upload' } })], error: /location/ },
        { name: 'chunk failure', responses: [new Response(null, { headers: { location: 'https://www.googleapis.com/upload/session' } }),
            new Response(null, { status: 503 })], error: /chunk failed/ },
        { name: 'incomplete upload', responses: [new Response(null, { headers: { location: 'https://www.googleapis.com/upload/session' } }),
            new Response(null, { status: 308 })], error: /did not complete/ },
    ];
    for (const example of failures) {
        await t.test(example.name, async t => {
            const path = await localClip(t, 3);
            const logs = [];
            t.mock.method(console, 'log', line => logs.push(line));
            mockRequests(t, [json({ access_token: 'test-access' }), json(privateFolder), json({ files: [] }), ...example.responses]);
            const upload = await createDrive(env, signal());

            await assert.rejects(upload(job, clip, path), example.error);
            assert.ok(logs.some(line => line.includes('upload_started')));
            assert.ok(logs.every(line => !line.includes('upload_completed')));
            assert.ok(logs.every(line => !line.includes('test-access')));
        });
    }
});
