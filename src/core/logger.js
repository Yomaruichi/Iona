const levels = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, CRITICAL: 5 };

function safeError(error) {
    // Error messages and stacks can contain credential-bearing URLs; retain classifications only.
    const code = error?.cause?.code ?? error?.code;
    return {
        errorType: /^[A-Za-z][A-Za-z0-9]*$/.test(error?.name || '') ? error.name : 'Error',
        errorCode: /^[A-Za-z0-9_-]{1,64}$/.test(String(code ?? '')) ? code : 'UNKNOWN',
    };
}

function isSecretVariable([name, secret]) {
    return /token|secret|password|credential|api.?key|mongo.?db/i.test(name) && secret.length >= 4;
}

function sanitizeText(value) {
    let text = value;
    for (const [, secret] of Object.entries(process.env).filter(isSecretVariable)) {
        text = text.split(secret).join('[REDACTED]');
    }
    return text.replace(/(?:https?:\/\/|mongodb(?:\+srv)?:\/\/)[^\s]+/gi, '[REDACTED_URL]')
        .replace(/[\r\n\t]/g, ' ').slice(0, 512);
}

function sanitizeObject(value) {
    if (Array.isArray(value)) return value.map(item => sanitize('item', item));
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitize(name, item)]));
}

function isSensitiveField(key, value) {
    return /token|secret|password|credential|authorization|api.?key|mongo.?db|uri|url/i.test(key) && typeof value !== 'boolean';
}

function sanitize(key, value) {
    if (isSensitiveField(key, value)) return '[REDACTED]';
    if (value instanceof Error) return safeError(value);
    if (value && typeof value === 'object') return sanitizeObject(value);
    if (typeof value === 'string') return sanitizeText(value);
    return value;
}

function createLogger(component, { sink } = {}) {
    return Object.fromEntries(Object.keys(levels).map(level => [level.toLowerCase(), (event, fields = {}) => {
        const minimum = levels[process.env.LOG_LEVEL?.toUpperCase()] ?? levels.INFO;
        if (levels[level] < minimum) return;
        const context = Object.entries(fields).map(([key, value]) => `${key}=${JSON.stringify(sanitize(key, value))}`).join(' ');
        const line = `[${level}] ${new Date().toISOString()} [${component}:${event}]${context ? ` ${context}` : ''}`;
        const write = sink || (levels[level] >= levels.ERROR ? console.error : level === 'WARN' ? console.warn : console.log);
        write(line);
    }]));
}

module.exports = { createLogger, safeError };
