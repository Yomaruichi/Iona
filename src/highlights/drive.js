const { open, stat } = require('node:fs/promises');
const { jsonRequest } = require('./services');
const { createLogger } = require('../core/logger');
const log = createLogger('highlights-drive');

async function createDrive(env, signal) {
    if (!/^[A-Za-z0-9_-]+$/.test(env.GOOGLE_DRIVE_FOLDER_ID)) throw new Error('Invalid Drive folder ID');
    const token = await jsonRequest('https://oauth2.googleapis.com/token', {
        method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
            refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }),
    }, signal);
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const folder = await jsonRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(env.GOOGLE_DRIVE_FOLDER_ID)}?fields=id,mimeType,permissions(type)`, { headers }, signal);
    if (folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error('Drive destination is not a folder');
    if (!Array.isArray(folder.permissions)) throw new Error('Cannot verify Drive folder privacy');
    if (folder.permissions.some(permission => ['anyone', 'domain'].includes(permission.type))) throw new Error('Drive folder must be private');

    return async function upload(job, clip, path) {
        const key = `${job.videoId}-${clip.id}`;
        const query = new URLSearchParams({ q: `trashed = false and '${env.GOOGLE_DRIVE_FOLDER_ID}' in parents and appProperties has { key='ionaClip' and value='${key}' }`, fields: 'files(id)' });
        const existing = await jsonRequest(`https://www.googleapis.com/drive/v3/files?${query}`, { headers }, signal);
        if (existing.files.length) return existing.files[0].id;
        // INFO before resumable upload; key is a deterministic clip identity for restart recovery.
        log.info('upload_started', { key });
        const bytes = (await stat(path)).size;
        const session = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
            signal, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(bytes) },
            body: JSON.stringify({ name: `${key}.mp4`, parents: [env.GOOGLE_DRIVE_FOLDER_ID], appProperties: { ionaClip: key } }),
        });
        if (!session.ok) throw new Error('Drive upload session failed');
        const location = session.headers.get('location');
        if (!location?.startsWith('https://www.googleapis.com/')) throw new Error('Invalid Drive upload location');
        const file = await open(path, 'r');
        try {
            for (let offset = 0; offset < bytes;) {
                const buffer = Buffer.alloc(Math.min(8 * 1024 * 1024, bytes - offset));
                const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
                if (!bytesRead) throw new Error('Unexpected clip EOF');
                const response = await fetch(location, { signal, method: 'PUT', headers: {
                    ...headers, 'Content-Length': String(bytesRead), 'Content-Range': `bytes ${offset}-${offset + bytesRead - 1}/${bytes}`,
                }, body: buffer.subarray(0, bytesRead) });
                offset += bytesRead;
                if (response.ok) {
                    const result = await response.json();
                    // INFO after Drive confirms completion; fileId is persisted by the worker next.
                    log.info('upload_completed', { fileId: result.id, bytes });
                    return result.id;
                }
                if (response.status !== 308) throw new Error('Drive upload chunk failed');
            }
            throw new Error('Drive upload did not complete');
        } finally { await file.close(); }
    };
}

module.exports = { createDrive };
