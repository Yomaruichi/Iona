const fs = require('fs');
const path = require('path');
const { registerRoute } = require('./webhookServer');
const { registerJob } = require('./scheduler');
const { createLogger } = require('./logger');
const log = createLogger('modules');

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

        mod.commands?.forEach(cmd => client.commands.set(cmd.data.name, cmd));
        mod.webhookRoutes?.forEach(r => registerRoute(r.path, r.middleware || [], r.handler));
        mod.cronJobs?.forEach(job => registerJob(job.schedule, job.task, `${mod.name}:${job.label || 'job'}`));

        // INFO after registration; counts describe enabled module capabilities, scope is informational.
        log.info('loaded', { name: mod.name, scope: mod.scope || 'public', commands: mod.commands?.length || 0, routes: mod.webhookRoutes?.length || 0, jobs: mod.cronJobs?.length || 0 });
    }
}

module.exports = { loadModules };
