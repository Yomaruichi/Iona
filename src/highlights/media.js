const { spawn } = require('node:child_process');
const { stat } = require('node:fs/promises');
const { join } = require('node:path');
const { createLogger } = require('../core/logger');
const log = createLogger('highlights-media');

function run(command, args, signal) {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const grouped = process.platform !== 'win32';
        const child = spawn(command, args, { detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
        const stop = () => {
            if (!child.pid) return;
            try { if (grouped) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ }
        };
        signal.addEventListener('abort', stop, { once: true });
        let output = '';
        child.stdout.on('data', chunk => {
            output += chunk;
            if (output.length > 1048576) stop();
        });
        child.stderr.resume(); // Downloader output may expose signed URLs; never forward it to logs.
        child.on('error', reject);
        child.on('close', code => {
            signal.removeEventListener('abort', stop);
            if (code === 0) return resolve(output);
            const error = new Error('Media tool failed');
            error.code = `MEDIA_EXIT_${code}`;
            reject(error);
        });
    });
}

async function encode(raw, output, seconds, signal) {
    await run('ffmpeg', ['-y', '-threads', '1', '-i', raw, '-t', String(seconds),
        '-vf', 'scale=-2:720:force_original_aspect_ratio=decrease', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast',
        '-crf', '26', '-c:a', 'aac', '-movflags', '+faststart', output], signal);
}

async function duration(videoId, signal) {
    const result = await run('yt-dlp', ['--js-runtimes', 'node', '--no-playlist', '--skip-download', '--dump-json', `https://www.youtube.com/watch?v=${videoId}`], signal);
    const value = JSON.parse(result).duration;
    if (!Number.isFinite(value) || value <= 0) throw new Error('Replay duration unavailable');
    return value;
}

async function extract(job, clip, directory, signal) {
    const raw = join(directory, 'section.mkv');
    const output = join(directory, 'clip.mp4');
    // INFO before section-only downloading; bounds identify the selected interval, not a full VOD.
    log.info('extraction_started', { videoId: job.videoId, start: clip.start, end: clip.end });
    await run('yt-dlp', ['--js-runtimes', 'node', '--no-playlist', '--no-progress', '--no-part', '--retries', '1',
        '--downloader', 'ffmpeg', '--download-sections', `*${clip.start}-${clip.end}`, '--force-keyframes-at-cuts',
        '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]', '--merge-output-format', 'mkv',
        '-o', raw, `https://www.youtube.com/watch?v=${job.videoId}`], signal);
    await encode(raw, output, clip.end - clip.start, signal);
    const bytes = (await stat(output)).size;
    if (bytes > 200 * 1024 * 1024) throw new Error('Clip exceeds prototype size limit');
    // INFO after encoding; bytes measures output size for benchmark review.
    log.info('extraction_completed', { videoId: job.videoId, bytes });
    return output;
}

module.exports = { run, duration, extract, encode };
