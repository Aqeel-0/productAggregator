'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Create GiST trigram indexes for efficient fuzzy search
    // These indexes enable fast similarity searches without loading all data
    
    // Index for model_name fuzzy search
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS products_model_name_trgm_gist_idx 
      ON products USING gist (model_name gist_trgm_ops);
    `);
    
    // Index for model_number fuzzy search  
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS products_model_number_trgm_gist_idx 
      ON products USING gist (model_number gist_trgm_ops);
    `);
    
    // Composite index for brand + model_name for scoped fuzzy search
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS products_brand_model_name_trgm_idx 
      ON products USING gist (brand_id, model_name gist_trgm_ops);
    `);
    
    // Regular indexes for exact matching (primary deduplication)
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS products_brand_model_number_idx 
      ON products (brand_id, model_number) WHERE model_number IS NOT NULL;
    `);
    
    console.log('✅ Added trigram indexes for efficient fuzzy search');
  },

  async down(queryInterface, Sequelize) {
    // Remove trigram indexes
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS products_model_name_trgm_gist_idx;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS products_model_number_trgm_gist_idx;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS products_brand_model_name_trgm_idx;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS products_brand_model_number_idx;');
    
    console.log('❌ Removed trigram indexes');
  }
};