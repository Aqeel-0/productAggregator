'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('listings', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      variant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'product_variants',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      store_name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      store_product_id: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      title: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      url: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        validate: {
          min: 0
        }
      },
      original_price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        validate: {
          min: 0
        }
      },
      discount_percentage: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        validate: {
          min: 0,
          max: 100
        }
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'INR'
      },
      stock_status: {
        type: Sequelize.ENUM('in_stock', 'out_of_stock', 'limited_stock', 'unknown'),
        allowNull: false,
        defaultValue: 'unknown'
      },
      stock_quantity: {
        type: Sequelize.INTEGER,
        allowNull: true,
        validate: {
          min: 0
        }
      },
      seller_name: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      seller_rating: {
        type: Sequelize.DECIMAL(3, 2),
        allowNull: true,
        validate: {
          min: 0,
          max: 5
        }
      },
      shipping_info: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      images: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      rating: {
        type: Sequelize.DECIMAL(3, 2),
        allowNull: true,
        validate: {
          min: 0,
          max: 5
        }
      },
      review_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        validate: {
          min: 0
        }
      },
      features: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      scraped_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      is_sponsored: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      affiliate_url: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      price_history: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: []
      },
      last_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
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

    // Add indexes for performance
    await queryInterface.addIndex('listings', ['variant_id'], {
      name: 'listings_variant_id_idx'
    });

    await queryInterface.addIndex('listings', ['store_name'], {
      name: 'listings_store_name_idx'
    });

    await queryInterface.addIndex('listings', ['store_product_id'], {
      name: 'listings_store_product_id_idx'
    });

    await queryInterface.addIndex('listings', ['price'], {
      name: 'listings_price_idx'
    });

    await queryInterface.addIndex('listings', ['stock_status'], {
      name: 'listings_stock_status_idx'
    });

    await queryInterface.addIndex('listings', ['is_active'], {
      name: 'listings_active_idx'
    });

    await queryInterface.addIndex('listings', ['scraped_at'], {
      name: 'listings_scraped_at_idx'
    });

    await queryInterface.addIndex('listings', ['last_seen_at'], {
      name: 'listings_last_seen_at_idx'
    });

    await queryInterface.addIndex('listings', ['rating'], {
      name: 'listings_rating_idx'
    });

    await queryInterface.addIndex('listings', ['discount_percentage'], {
      name: 'listings_discount_idx'
    });

    // Composite indexes
    await queryInterface.addIndex('listings', ['variant_id', 'store_name', 'is_active'], {
      name: 'listings_composite_idx'
    });

    await queryInterface.addIndex('listings', ['price', 'stock_status', 'is_active'], {
      name: 'listings_price_range_idx'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('listings');
  }
}; 