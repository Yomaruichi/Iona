const fs = require('fs');
const path = require('path');
const { registerRoute } = require('./webhookServer');
const { registerJob } = require('./scheduler');

function loadModules(client) {
    const modulesPath = path.join(__dirname, '..', 'modules');
    if (!fs.existsSync(modulesPath)) return;

    const folders = fs.readdirSync(modulesPath, { withFileTypes: true })
        .filter(d => d.isDirectory());

    for (const folder of folders) {
        const mod = require(path.join(modulesPath, folder.name, 'index.js'));

        mod.commands?.forEach(cmd => client.commands.set(cmd.data.name, cmd));
        mod.webhookRoutes?.forEach(r => registerRoute(r.path, r.middleware || [], r.handler));
        mod.cronJobs?.forEach(job => registerJob(job.schedule, job.task, `${mod.name}:${job.label || 'job'}`));

        console.log(`Loaded module: ${mod.name} (scope: ${mod.scope || 'public'})`);
    }
}

module.exports = { loadModules };