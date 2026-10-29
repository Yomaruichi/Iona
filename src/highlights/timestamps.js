function parseTimestamp(line) {
    const match = line.match(/^\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})\s*[-–—:]?\s*(.+)$/);
    if (!match) return;
    const [, hours = '0', minutes, seconds, description] = match;
    if (+seconds >= 60) return;
    if (match[1] !== undefined && +minutes >= 60) return;
    return { seconds: +hours * 3600 + +minutes * 60 + +seconds, description: description.trim() };
}

function timestamps(comments) {
    const entries = new Map();
    const lines = comments.slice(0, 100).flatMap(comment => comment.text.split(/\r?\n/));
    for (const line of lines) {
        const entry = parseTimestamp(line);
        if (!entry) continue;
        const key = `${entry.seconds}:${entry.description.toLowerCase()}`;
        if (!entries.has(key)) entries.set(key, { ...entry, id: `t${entries.size}`, description: entry.description.slice(0, 500) });
    }
    return [...entries.values()];
}

function clipWindow(seconds, duration) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid replay duration');
    if (!Number.isFinite(seconds)) throw new Error('Timestamp outside replay');
    if (seconds < 0) throw new Error('Timestamp outside replay');
    if (seconds >= duration) throw new Error('Timestamp outside replay');
    return { start: Math.max(0, seconds - 30), end: Math.min(duration, seconds + 90) };
}

function selectedClip(id, candidates, duration) {
    const entry = candidates.find(candidate => candidate.id === id);
    if (!entry) throw new Error('Unknown timestamp ID');
    return { ...entry, ...clipWindow(entry.seconds, duration) };
}

function requireNonOverlapping(selected) {
    const ordered = [...selected].sort((a, b) => a.start - b.start);
    for (let i = 1; i < ordered.length; i++) {
        if (ordered[i].start < ordered[i - 1].end) throw new Error('Overlapping highlight selection');
    }
}

function validateSelection(ids, candidates, duration, limit = 3) {
    if (!Array.isArray(ids)) throw new Error('Invalid highlight selection');
    if (!ids.length) throw new Error('Invalid highlight selection');
    if (ids.length > limit) throw new Error('Invalid highlight selection');
    const selected = ids.map(id => selectedClip(id, candidates, duration));
    requireNonOverlapping(selected);
    return selected;
}

module.exports = { timestamps, clipWindow, validateSelection };
