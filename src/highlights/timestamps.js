function timestamps(comments) {
    const entries = new Map();
    for (const comment of comments.slice(0, 100)) {
        for (const line of comment.text.split(/\r?\n/)) {
            const match = line.match(/^\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})\s*[-–—:]?\s*(.+)$/);
            if (!match) continue;
            const [, hours, minutes, seconds, description] = match;
            if (+seconds >= 60 || (hours !== undefined && +minutes >= 60)) continue;
            const time = +(hours || 0) * 3600 + +minutes * 60 + +seconds;
            const key = `${time}:${description.trim().toLowerCase()}`;
            if (!entries.has(key)) entries.set(key, { id: `t${entries.size}`, seconds: time, description: description.trim().slice(0, 500) });
        }
    }
    return [...entries.values()];
}

function clipWindow(seconds, duration) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid replay duration');
    if (!Number.isFinite(seconds) || seconds < 0 || seconds >= duration) throw new Error('Timestamp outside replay');
    return { start: Math.max(0, seconds - 30), end: Math.min(duration, seconds + 90) };
}

function validateSelection(ids, candidates, duration, limit = 3) {
    if (!Array.isArray(ids) || !ids.length || ids.length > limit) throw new Error('Invalid highlight selection');
    const selected = ids.map(id => {
        const entry = candidates.find(candidate => candidate.id === id);
        if (!entry) throw new Error('Unknown timestamp ID');
        return { ...entry, ...clipWindow(entry.seconds, duration) };
    });
    const ordered = [...selected].sort((a, b) => a.start - b.start);
    for (let i = 1; i < ordered.length; i++) {
        if (ordered[i].start < ordered[i - 1].end) throw new Error('Overlapping highlight selection');
    }
    return selected;
}

module.exports = { timestamps, clipWindow, validateSelection };
