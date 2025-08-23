const { DataTypes, Model, Op } = require('sequelize');
const { sequelize } = require('../../config/sequelize');

class Brand extends Model {
  /**
   * Helper method for defining associations.
   * This method is not a part of Sequelize lifecycle.
   * The `models/index` file will call this method automatically.
   */
  static associate(models) {
    // A brand has many products
    Brand.hasMany(models.Product, {
      foreignKey: 'brand_id',
      as: 'products'
    });
  }

  /**
   * Create a URL-friendly slug from the brand name
   */
  static generateSlug(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  }

  static async findOrCreateByName(name, supabase) {
    const slug = Brand.generateSlug(name);
    
    // First, try to find by slug
    const { data: brandBySlug, error: slugError } = await supabase
      .from('brands')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();
      
    if (slugError) {
      throw new Error(`Error finding brand by slug: ${slugError.message}`);
    }
    
    if (brandBySlug) {
      return { brand: brandBySlug, created: false };
    }
    
    // Try to find by name
    const { data: brandByName, error: nameError } = await supabase
      .from('brands')
      .select('*')
      .eq('name', name.trim())
      .maybeSingle();
      
    if (nameError) {
      throw new Error(`Error finding brand by name: ${nameError.message}`);
    }
    
    if (brandByName) {
      return { brand: brandByName, created: false };
    }
    
    // Create new brand if not found
    const { data: newBrand, error: insertError } = await supabase
      .from('brands')
      .insert([{
        name: name.trim(),
        slug: slug,
        is_active: true
      }])
      .select()
      .single();
      
    if (insertError) {
      throw new Error(`Error creating brand: ${insertError.message}`);
    }
    
    return { brand: newBrand, created: true };
  }

  /**
   * Enhanced insertion method with caching and statistics
   * Used by DatabaseInserter for optimized brand creation
   */
  static async insertWithCache(brandName, cache, stats, supabase) {
    if (!brandName) return null;

    const normalizedName = brandName.trim();
    if (cache.has(normalizedName)) {
      return cache.get(normalizedName);
    }

    try {
      const { brand, created } = await Brand.findOrCreateByName(normalizedName, supabase);
      cache.set(normalizedName, brand.id);
      
      if (created) {
        stats.brands.created++;
      } else {
        stats.brands.existing++;
      }
      
      return brand.id;
    } catch (error) {
      console.error(`❌ Error creating brand "${normalizedName}":`, error.message);
      stats.errors.push(`Brand: ${normalizedName} - ${error.message}`);
      return null;
    }
  }
}

Brand.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true,
      len: [1, 100]
    }
  },
  slug: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true,
      len: [1, 100]
    }
  },
  logo_url: {
    type: DataTypes.TEXT,
    allowNull: true,
    validate: {
      isUrl: true
    }
  },
  website_url: {
    type: DataTypes.TEXT,
    allowNull: true,
    validate: {
      isUrl: true
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'Brand',
  tableName: 'brands',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'brands_name_idx',
      fields: ['name']
    },
    {
      name: 'brands_slug_idx',
      fields: ['slug']
    },
    {
      name: 'brands_active_idx',
      fields: ['is_active']
    }
  ],
  hooks: {
    beforeValidate: (brand) => {
      if (brand.name && !brand.slug) {
        brand.slug = Brand.generateSlug(brand.name);
      }
    }
  }
});

module.exports = Brand; 