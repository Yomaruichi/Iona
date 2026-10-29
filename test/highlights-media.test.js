const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtemp, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { run, encode } = require('../src/highlights/media');
const { mediaError } = require('../src/highlights/media-errors');
const available = spawnSync('ffmpeg', ['-version']).status === 0;

test('media diagnostics distinguish access blocks, missing formats and runtime failures without exposing stderr', () => {
    const cases = [
        ["Sign in to confirm you’re not a bot", 'MEDIA_BOT_CHECK'],
        ['Sign in to confirm your age', 'MEDIA_AUTH_REQUIRED'],
        ['HTTP Error 429: Too Many Requests', 'MEDIA_RATE_LIMITED'],
        ['HTTP error 403 Forbidden', 'MEDIA_ACCESS_DENIED'],
        ['Requested format is not available', 'MEDIA_FORMAT_UNAVAILABLE'],
        ['No supported JavaScript runtime could be found', 'MEDIA_JS_CHALLENGE_FAILED'],
        ['ffmpeg is not installed', 'MEDIA_FFMPEG_MISSING'],
        ['No space left on device', 'MEDIA_DISK_FULL'],
        ['Temporary failure in name resolution', 'MEDIA_NETWORK_FAILURE'],
        ['Video unavailable', 'MEDIA_SOURCE_UNAVAILABLE'],
        ['unrecognized arguments: --js-runtimes', 'MEDIA_UNSUPPORTED_OPTION'],
        ['section.mkv: No such file or directory', 'MEDIA_FILE_MISSING'],
        ['Unrecognized failure', 'MEDIA_EXIT_1'],
    ];
    for (const [message, expected] of cases) {
        // Diagnostic content is classified into fixed codes, never copied into an error message.
        const error = mediaError(1, `${message} https://example.com/video?token=secret-test-token`);
        assert.equal(error.code, expected);
        assert.equal(error.message, 'Media tool failed');
    }
});

test('failed media subprocesses report a safe classification without logging signed URLs or credentials', async t => {
    const logs = [];
    t.mock.method(console, 'error', line => logs.push(line));
    // A local child process reproduces yt-dlp stderr without contacting YouTube.
    const script = "process.stderr.write('Requested format is not available https://example.com/video?token=secret-test-token'); process.exitCode = 1;";

    await assert.rejects(run(process.execPath, ['-e', script], AbortSignal.timeout(5000)), { code: 'MEDIA_FORMAT_UNAVAILABLE' });

    assert.ok(logs.some(line => line.includes('tool_failed')));
    assert.ok(logs.some(line => line.includes('MEDIA_FORMAT_UNAVAILABLE')));
    assert.ok(logs.every(line => !line.includes('secret-test-token')));
    assert.ok(logs.every(line => !line.includes('example.com')));
});

test('successful media commands tolerate stderr warnings and return stdout unchanged', async t => {
    const logs = [];
    t.mock.method(console, 'error', line => logs.push(line));
    const script = "process.stderr.write('WARNING: format may be unavailable'); process.stdout.write('metadata');";

    const output = await run(process.execPath, ['-e', script], AbortSignal.timeout(5000));

    assert.equal(output, 'metadata');
    assert.equal(logs.length, 0);
});

test('FFmpeg encodes a bounded MP4 from a generated local video fixture', { skip: !available }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'iona-ffmpeg-'));
    const signal = AbortSignal.timeout(30000);
    try {
        const input = join(directory, 'fixture.mp4');
        const output = join(directory, 'clip.mp4');
        // A tiny synthetic fixture exercises encoding without downloading copyrighted source media.
        await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10', '-t', '3', '-pix_fmt', 'yuv420p', input], signal);
        await encode(input, output, 1, signal);
        assert.ok((await stat(output)).size > 0);
        const metadata = JSON.parse(await run('ffprobe', ['-v', 'quiet', '-show_format', '-show_streams', '-of', 'json', output], signal));
        assert.ok(+metadata.format.duration <= 1.2);
        assert.ok(metadata.streams[0].height <= 720);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
