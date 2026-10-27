const fs = require('fs');
const path = require('path');
const { registerRoute } = require('./webhookServer');
const { registerJob } = require('./scheduler');
const { createLogger } = require('./logger');
const log = createLogger('modules');

function moduleCapabilities(mod) {
    return {
        name: mod.name,
        scope: mod.scope || 'public',
        commands: mod.commands || [],
        webhookRoutes: mod.webhookRoutes || [],
        cronJobs: mod.cronJobs || [],
    };
}

function registerModule(client, definition) {
    const mod = moduleCapabilities(definition);
    mod.commands.forEach(command => client.commands.set(command.data.name, command));
    mod.webhookRoutes.forEach(route => registerRoute(route.path, route.middleware || [], route.handler));
    mod.cronJobs.forEach(job => registerJob(job.schedule, job.task, `${mod.name}:${job.label || 'job'}`));
    // INFO after registering capabilities; scope is informational and counts describe enabled features.
    log.info('loaded', {
        name: mod.name, scope: mod.scope,
        commands: mod.commands.length, routes: mod.webhookRoutes.length, jobs: mod.cronJobs.length,
    });
}

function loadModules(client) {
    const modulesPath = path.join(__dirname, '..', 'modules');
    if (!fs.existsSync(modulesPath)) {
        // INFO for a deployment without integrations; nothing is registered.
        log.info('loading_skipped', { reason: 'no_modules_directory' });
        return;
    }

    const folders = fs.readdirSync(modulesPath, { withFileTypes: true })
        .filter(d => d.isDirectory());

    for (const folder of folders) {
        // INFO before importing one module; folder identifies the integration being initialized.
        log.info('loading_started', { folder: folder.name });
        const mod = require(path.join(modulesPath, folder.name, 'index.js'));

        registerModule(client, mod);
    }
}

module.exports = { loadModules, registerModule };
