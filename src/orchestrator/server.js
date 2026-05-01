#!/usr/bin/env node

/**
 * Standalone Dashboard Server
 * Run this to start the control center dashboard
 */

const DashboardServer = require('./DashboardServer');

const port = process.argv[2] || 3001;

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║         AggreMart Control Center - Starting...                ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('');

const dashboard = new DashboardServer(port);

dashboard.start()
  .then(() => {
    console.log('');
    console.log('🎉 Control Center is ready!');
    console.log('');
    console.log(`📊 Open your browser to: http://localhost:${port}`);
    console.log('');
    console.log('Features:');
    console.log('  ✅ Start/stop individual scrapers');
    console.log('  ✅ Configure scraper settings');
    console.log('  ✅ Real-time progress monitoring');
    console.log('  ✅ Normalize scraped data');
    console.log('  ✅ Insert data to database');
    console.log('  ✅ View activity logs');
    console.log('');
    console.log('Press Ctrl+C to stop');
    console.log('');
  })
  .catch((error) => {
    console.error('❌ Failed to start dashboard:', error.message);
    process.exit(1);
  });

function gracefulShutdown() {
  console.log('\n\nShutting down gracefully...');

  // Safety net: force exit after 15s no matter what
  const forceExit = setTimeout(() => {
    console.log('Forcing exit after timeout...');
    process.exit(0);
  }, 15000).unref();

  dashboard.stop().then(() => {
    clearTimeout(forceExit);
    console.log('Goodbye!');
    process.exit(0);
  });
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
