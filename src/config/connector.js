// index.js
const { Client } = require('pg');

async function main() {
  // configure your connection details here
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '1234',
    database: 'aggregatorDB',
  });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL');

    // (optional) run a test query
    const res = await client.query('SELECT NOW()');
    console.log('Server time:', res.rows[0].now);

  } catch (err) {
    console.error('❌ Connection error:', err.stack);
  } finally {
    await client.end();
    console.log('🔌 Connection closed');
  }
}

main();
