module.exports = {
  apps: [
    {
      name: 'sanity-studio',
      script: 'C:\\Users\\Jasper Koning\\AppData\\Roaming\\npm\\node_modules\\npm\\bin\\npm-cli.js',
      args: 'run dev',
      cwd: 'C:\\dev\\amersfoort',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
}
