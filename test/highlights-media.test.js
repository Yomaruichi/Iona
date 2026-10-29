const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtemp, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { run, encode } = require('../src/highlights/media');
const available = spawnSync('ffmpeg', ['-version']).status === 0;

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
