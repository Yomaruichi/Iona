const { createUploadChecker } = require('./uploads');

function createMonitoringJobs({ channelIds, ...dependencies }) {
    return channelIds.map(channelId => ({
        schedule: '0 */1 * * *',
        label: `uploads:${channelId}`,
        task: createUploadChecker({ ...dependencies, channelId }),
    }));
}

module.exports = { createMonitoringJobs };
