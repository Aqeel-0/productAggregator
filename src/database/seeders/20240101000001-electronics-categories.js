const { v4: uuidv4 } = require('uuid');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const now = new Date();
    
    // Helper function to create category slug
    const createSlug = (name) => {
      return name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    };

    // Electronics category structure based on GPT categorization
    const categories = [
      // Root category
      {
        id: uuidv4(),
        name: 'Electronics',
        slug: 'electronics',
        parent_id: null,
        level: 0,
        path: '/electronics',
        description: 'Consumer electronics, gadgets, and technology products',
        icon: 'electronics',
        sort_order: 1,
        is_active: true,
        is_featured: true,
        created_at: now,
        updated_at: now
      }
    ];

    // Get the root electronics category ID
    const electronicsId = categories[0].id;

    // Level 1 categories - Updated to match GPT categories
    const level1Categories = [
      {
        id: uuidv4(),
        name: 'Mobile Phones',
        slug: 'mobile-phones',
        parent_id: electronicsId,
        level: 1,
        path: '/electronics/mobile-phones',
        description: 'Smartphones and mobile phones',
        icon: 'smartphone',
        sort_order: 1,
        is_active: true,
        is_featured: true,
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        name: 'Laptops',
        slug: 'laptops',
        parent_id: electronicsId,
        level: 1,
        path: '/electronics/laptops',
        description: 'Laptops and notebooks',
        icon: 'laptop',
        sort_order: 2,
        is_active: true,
        is_featured: true,
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        name: 'Desktops',
        slug: 'desktops',
        parent_id: electronicsId,
        level: 1,
        path: '/electronics/desktops',
        description: 'Desktop computers',
        icon: 'desktop',
        sort_order: 3,
        is_active: true,
        is_featured: true,
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        name: 'Tablets',
        slug: 'tablets',
        parent_id: electronicsId,
        level: 1,
        path: '/electronics/tablets',
        description: 'Tablets and iPads',
        icon: 'tablet',
        sort_order: 4,
        is_active: true,
        is_featured: true,
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        name: 'Televisions',
        slug: 'televisions',
        parent_id: electronicsId,
        level: 1,
        path: '/electronics/televisions',
        description: 'TVs and televisions',
        icon: 'tv',
        sort_order: 5,
        is_active: true,
        is_featured: true,
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        name: 'Cameras',
        slug: 'cameras',
        parent_id: electronicsId,
        level: 1,
        path: '/electronics/cameras',
        description: 'Digital cameras and DSLRs',
        icon: 'camera',
        sort_order: 6,
        is_active: true,
        is_featured: true,
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        name: 'Gaming Consoles',
        slug: 'gaming-consoles',
        parent_id: electronicsId,
        level: 1,
        path: '/electronics/gaming-consoles',
        description: 'Gaming consoles and handhelds',
        icon: 'gamepad',
        sort_order: 7,
        is_active: true,
        is_featured: true,
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        name: 'Smartwatches',
        slug: 'smartwatches',
        parent_id: electronicsId,
        level: 1,
        path: '/electronics/smartwatches',
        description: 'Smartwatches and fitness trackers',
        icon: 'smartwatch',
        sort_order: 8,
        is_active: true,
        is_featured: true,
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        name: 'Headphones',
        slug: 'headphones',
        parent_id: electronicsId,
        level: 1,
        path: '/electronics/headphones',
        description: 'Headphones and earphones',
        icon: 'headphones',
        sort_order: 9,
        is_active: true,
        is_featured: true,
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        name: 'Mobile Accessories',
        slug: 'mobile-accessories',
        parent_id: electronicsId,
        level: 1,
        path: '/electronics/mobile-accessories',
        description: 'Phone cases, chargers, and accessories',
        icon: 'mobile-accessories',
        sort_order: 10,
        is_active: true,
        is_featured: false,
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        name: 'Power Banks',
        slug: 'power-banks',
        parent_id: electronicsId,
        level: 1,
        path: '/electronics/power-banks',
        description: 'Power banks and portable chargers',
        icon: 'battery',
        sort_order: 11,
        is_active: true,
        is_featured: false,
        created_at: now,
        updated_at: now
      }
    ];

    // Add all categories
    categories.push(...level1Categories);

    // Insert all categories
    await queryInterface.bulkInsert('categories', categories);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('categories', null, {});
  }
}; 