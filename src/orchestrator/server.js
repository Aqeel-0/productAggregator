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

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  dashboard.stop().then(() => {
    console.log('Goodbye!');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n\nShutting down gracefully...');
  dashboard.stop().then(() => {
    console.log('Goodbye!');
    process.exit(0);
  });
});
