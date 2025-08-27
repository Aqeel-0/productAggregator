const { v4: uuidv4 } = require('uuid');
const supabase = require('../../services/supabase').getClient();

function createSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function seedCategories() {
  const now = new Date().toISOString();
  const categories = [];

  // Root category
  const homeId = uuidv4();
  categories.push({
    id: homeId,
    name: 'Home',
    slug: 'home',
    parent_id: null,
    level: 0,
    path: '/home',
    description: 'Home and lifestyle products',
    sort_order: 1,
    is_active: true,
    is_featured: true,
    product_count: 0,
    created_at: now,
    updated_at: now
  });

  // Electronics under Home
  const electronicsId = uuidv4();
  categories.push({
    id: electronicsId,
    name: 'Electronics',
    slug: 'electronics',
    parent_id: homeId,
    level: 1,
    path: '/home/electronics',
    description: 'Consumer electronics, gadgets, and technology products',
    sort_order: 1,
    is_active: true,
    is_featured: true,
    product_count: 0,
    created_at: now,
    updated_at: now
  });

  // Mobiles & Accessories under Electronics
  const mobileAccessoriesId = uuidv4();
  categories.push({
    id: mobileAccessoriesId,
    name: 'Mobiles & Accessories',
    slug: 'mobiles-accessories',
    parent_id: electronicsId,
    level: 2,
    path: '/home/electronics/mobiles-accessories',
    description: 'Mobile phones and related accessories',
    sort_order: 1,
    is_active: true,
    is_featured: true,
    product_count: 0,
    created_at: now,
    updated_at: now
  });

  // Mobiles and Accessories (level 3)
  const mobilesId = uuidv4();
  const accessoriesId = uuidv4();
  categories.push(
    {
      id: mobilesId,
      name: 'Mobiles',
      slug: 'mobiles',
      parent_id: mobileAccessoriesId,
      level: 3,
      path: '/home/electronics/mobiles-accessories/mobiles',
      description: 'Mobile phones and smartphones',
      sort_order: 1,
      is_active: true,
      is_featured: true,
      product_count: 0,
      created_at: now,
      updated_at: now
    },
    {
      id: accessoriesId,
      name: 'Accessories',
      slug: 'accessories',
      parent_id: mobileAccessoriesId,
      level: 3,
      path: '/home/electronics/mobiles-accessories/accessories',
      description: 'Mobile phone accessories and add-ons',
      sort_order: 2,
      is_active: true,
      is_featured: true,
      product_count: 0,
      created_at: now,
      updated_at: now
    }
  );

  // Smartphones and Basic Phones (level 4)
  const smartphonesId = uuidv4();
  const basicPhonesId = uuidv4();
  categories.push(
    {
      id: smartphonesId,
      name: 'Smartphones',
      slug: 'smartphones',
      parent_id: mobilesId,
      level: 4,
      path: '/home/electronics/mobiles-accessories/mobiles/smartphones',
      description: 'Advanced smartphones with smart features',
      sort_order: 1,
      is_active: true,
      is_featured: true,
      product_count: 0,
      created_at: now,
      updated_at: now
    },
    {
      id: basicPhonesId,
      name: 'Basic Mobiles',
      slug: 'basic-mobiles',
      parent_id: mobilesId,
      level: 4,
      path: '/home/electronics/mobiles-accessories/mobiles/basic-mobiles',
      description: 'Basic mobile phones and feature mobiles',
      sort_order: 2,
      is_active: true,
      is_featured: false,
      product_count: 0,
      created_at: now,
      updated_at: now
    }
  );

  // Level 5: Brand and accessory categories
  const smartphoneBrands = [
    'Apple', 'Samsung', 'OnePlus', 'Xiaomi', 'Realme', 'OPPO', 'Vivo',
    'POCO', 'Motorola', 'iQOO', 'Nothing', 'Google', 'Infinix', 'Tecno'
  ];
  smartphoneBrands.forEach((brandName, index) => {
    categories.push({
      id: uuidv4(),
      name: `${brandName} Smartphones`,
      slug: createSlug(`${brandName}-smartphones`),
      parent_id: smartphonesId,
      level: 5,
      path: `/home/electronics/mobiles-accessories/mobiles/smartphones/${createSlug(brandName)}-smartphones`,
      description: `${brandName} smartphones and mobile devices`,
      sort_order: index + 1,
      is_active: true,
      is_featured: index < 8,
      product_count: 0,
      created_at: now,
      updated_at: now
    });
  });

  const basicPhoneBrands = [
    'Nokia', 'Jio', 'Kechaoda', 'Lava', 'HMD', 'Itel'
  ];
  basicPhoneBrands.forEach((brandName, index) => {
    categories.push({
      id: uuidv4(),
      name: `${brandName} Basic Phones`,
      slug: createSlug(`${brandName}-basic-phones`),
      parent_id: basicPhonesId,
      level: 5,
      path: `/home/electronics/mobiles-accessories/mobiles/basic-phones/${createSlug(brandName)}-basic-phones`,
      description: `${brandName} basic mobile phones and feature phones`,
      sort_order: index + 1,
      is_active: true,
      is_featured: false,
      product_count: 0,
      created_at: now,
      updated_at: now
    });
  });

  const accessoryCategories = [
    'Phone Cases & Covers', 'Screen Protectors', 'Chargers & Cables',
    'Power Banks', 'Earphones & Headphones', 'Phone Stands & Holders',
    'Car Accessories', 'Gaming Accessories', 'Protection & Safety'
  ];
  accessoryCategories.forEach((accessoryName, index) => {
    categories.push({
      id: uuidv4(),
      name: accessoryName,
      slug: createSlug(accessoryName),
      parent_id: accessoriesId,
      level: 5,
      path: `/home/electronics/mobiles-accessories/accessories/${createSlug(accessoryName)}`,
      description: `${accessoryName} for mobile phones`,
      sort_order: index + 1,
      is_active: true,
      is_featured: index < 5,
      product_count: 0,
      created_at: now,
      updated_at: now
    });
  });

  // Insert all categories (can also do in batches if needed)
  // Optionally, clear table before insert (dangerous! use with care)
  await supabase.from('categories').delete().neq('id', '');

  const { error } = await supabase.from('categories').insert(categories);

  if (error) {
    console.error('❌ Error seeding categories:', error.details || error.message);
    process.exit(1);
  } else {
    console.log('✅ Categories seeded successfully!');
  }
}

seedCategories();
