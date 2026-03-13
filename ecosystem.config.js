module.exports = {
    apps: [
        {
            name: 'clawgate-gateway',
            script: 'npm',
            args: 'run start:light',
            env: {
                NODE_ENV: 'production',
                NODE_OPTIONS: '--max-old-space-size=512'
            },
            max_memory_restart: '768M',
            restart_delay: 3000,
            log_date_format: 'YYYY-MM-DD HH:mm:ss'
        }
    ]
};
