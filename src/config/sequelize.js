const { Sequelize } = require('sequelize');

// Create Sequelize instance with the same credentials as connector.js
const sequelize = new Sequelize({
  dialect: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: '1234',
  database: 'aggregatorDB',
  logging: false, // Set to console.log to see SQL queries
  define: {
    timestamps: true,
    underscored: true,
    freezeTableName: true
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// Test the connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Sequelize connection established successfully.');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to the database with Sequelize:', error);
    return false;
  }
};

module.exports = {
  sequelize,
  testConnection
}; 