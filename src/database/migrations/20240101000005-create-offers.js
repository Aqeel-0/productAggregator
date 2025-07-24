module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('offers', {
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
      url: {
        type: Sequelize.TEXT,
        allowNull: false,
        validate: {
          isUrl: true
        }
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
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'INR',
        validate: {
          isIn: [['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD']]
        }
      },
      affiliate_url: {
        type: Sequelize.TEXT,
        allowNull: true,
        validate: {
          isUrl: true
        }
      },
      stock_status: {
        type: Sequelize.ENUM('in_stock', 'out_of_stock', 'limited_stock', 'unknown'),
        allowNull: false,
        defaultValue: 'unknown'
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
      is_sponsored: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      scraped_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      last_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
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

    // Add indexes for performance
    await queryInterface.addIndex('offers', ['variant_id'], {
      name: 'offers_variant_id_idx'
    });

    await queryInterface.addIndex('offers', ['store_name'], {
      name: 'offers_store_name_idx'
    });

    await queryInterface.addIndex('offers', ['price'], {
      name: 'offers_price_idx'
    });

    await queryInterface.addIndex('offers', ['stock_status'], {
      name: 'offers_stock_status_idx'
    });

    await queryInterface.addIndex('offers', ['is_active'], {
      name: 'offers_active_idx'
    });

    await queryInterface.addIndex('offers', ['scraped_at'], {
      name: 'offers_scraped_at_idx'
    });

    await queryInterface.addIndex('offers', ['last_seen_at'], {
      name: 'offers_last_seen_at_idx'
    });

    // Composite unique constraint
    await queryInterface.addIndex('offers', ['variant_id', 'store_name', 'store_product_id'], {
      name: 'offers_variant_store_unique_idx',
      unique: true
    });

    // Composite index for price comparison queries
    await queryInterface.addIndex('offers', ['variant_id', 'price', 'is_active'], {
      name: 'offers_price_comparison_idx'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('offers');
  }
}; 