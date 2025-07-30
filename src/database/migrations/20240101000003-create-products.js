'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('products', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      brand_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'brands',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      category_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'categories',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      model_name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      model_number: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      slug: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      specifications: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('active', 'discontinued', 'coming_soon'),
        allowNull: false,
        defaultValue: 'active'
      },
      variant_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      min_price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      max_price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      avg_price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      rating: {
        type: Sequelize.DECIMAL(3, 2),
        allowNull: true
      },
      is_featured: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      launch_date: {
        type: Sequelize.DATE,
        allowNull: true
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    // Add indexes
    await queryInterface.addIndex('products', ['brand_id']);
    await queryInterface.addIndex('products', ['category_id']);
    await queryInterface.addIndex('products', ['model_name']);
    await queryInterface.addIndex('products', ['model_number']);
    await queryInterface.addIndex('products', ['slug'], { unique: true });
    await queryInterface.addIndex('products', ['status']);
    await queryInterface.addIndex('products', ['is_featured']);
    await queryInterface.addIndex('products', ['min_price', 'max_price']);
    await queryInterface.addIndex('products', ['rating']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('products');
  }
}; 