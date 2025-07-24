module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('product_variants', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      product_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'products',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      sku: {
        type: Sequelize.STRING(100),
        allowNull: true,
        unique: true
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      attributes: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {}
      },
      images: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Add indexes
    await queryInterface.addIndex('product_variants', ['product_id'], {
      name: 'product_variants_product_id_idx'
    });
    await queryInterface.addIndex('product_variants', ['sku'], {
      name: 'product_variants_sku_idx'
    });
    await queryInterface.addIndex('product_variants', ['is_active'], {
      name: 'product_variants_active_idx'
    });
    await queryInterface.addIndex('product_variants', ['attributes'], {
      name: 'product_variants_attributes_idx',
      using: 'gin'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('product_variants');
  }
}; 