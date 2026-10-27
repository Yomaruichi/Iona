const express = require('express');
const app = express();
const { createLogger, safeError } = require('./logger');
const log = createLogger('webhooks');

app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; } // needed for HMAC verification later
}));

function registerRoute(path, middleware, handler) {
    app.post(path, (req, res, next) => {
        // INFO for a registered webhook request; route is a static pattern, never the raw URL or payload.
        log.info('request_received', { route: path });
        res.once('finish', () => {
            // INFO or WARN after response completion; status records acceptance or rejection.
            const level = res.statusCode >= 400 ? 'warn' : 'info';
            log[level]('request_completed', { route: path, status: res.statusCode });
        });
        next();
    }, ...middleware, handler);
    // INFO after a POST handler is installed; path is its configured route pattern.
    log.info('route_registered', { route: path, method: 'POST' });
}

function start(port = process.env.PORT || process.env.WEBHOOK_PORT || 3000) {
    // INFO before binding the shared HTTP listener; port excludes credentials or public endpoint URLs.
    log.info('listener_starting', { port });
    app.use((error, req, res, next) => {
        // ERROR for a failed handler; omit payload, headers and raw error messages.
        const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
        log.error('request_failed', { ...safeError(error), status, nextAction: 'error_response' });
        if (res.headersSent) return next(error);
        res.status(status).json({ error: 'Webhook processing failed' });
    });
    const server = app.listen(port, () => {
        // INFO only after the OS successfully binds the socket.
        log.info('listener_ready', { port });
    });
    server.on('error', error => {
        // CRITICAL because incoming hooks cannot work without the shared listener; restart is required.
        log.critical('listener_failed', { port, ...safeError(error), nextAction: 'stop_service' });
        process.exitCode = 1;
        process.exit(1);
    });
    return server;
}

module.exports = { registerRoute, start };
