'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add pg_trgm extension for efficient fuzzy text search
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    
    console.log('✅ Added pg_trgm extension for trigram-based fuzzy search');
  },

  async down(queryInterface, Sequelize) {
    // Remove pg_trgm extension
    await queryInterface.sequelize.query('DROP EXTENSION IF EXISTS pg_trgm CASCADE;');
    
    console.log('❌ Removed pg_trgm extension');
  }
};