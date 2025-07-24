const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../../config/sequelize');

class Category extends Model {
  /**
   * Helper method for defining associations.
   */
  static associate(models) {
    // Self-referencing association for parent-child relationship
    Category.belongsTo(models.Category, {
      foreignKey: 'parent_id',
      as: 'parent'
    });
    
    Category.hasMany(models.Category, {
      foreignKey: 'parent_id',
      as: 'children'
    });

    // A category has many products
    Category.hasMany(models.Product, {
      foreignKey: 'category_id',
      as: 'products'
    });
  }

  /**
   * Create a URL-friendly slug from the category name
   */
  static generateSlug(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Generate path from root to this category
   */
  static async generatePath(categoryId, parentId = null) {
    if (!parentId) return `/${this.generateSlug(categoryId)}`;
    
    const parent = await Category.findByPk(parentId);
    if (!parent) return `/${this.generateSlug(categoryId)}`;
    
    return `${parent.path}/${this.generateSlug(categoryId)}`;
  }

  /**
   * Get root categories (level 0)
   */
  static async getRootCategories() {
    return await Category.findAll({
      where: { 
        parent_id: null,
        is_active: true 
      },
      order: [['sort_order', 'ASC'], ['name', 'ASC']]
    });
  }

  /**
   * Get category tree with all descendants
   */
  static async getCategoryTree(maxDepth = 3) {
    const buildTree = async (parentId = null, currentDepth = 0) => {
      if (currentDepth >= maxDepth) return [];
      
      const categories = await Category.findAll({
        where: { 
          parent_id: parentId,
          is_active: true 
        },
        order: [['sort_order', 'ASC'], ['name', 'ASC']]
      });

      const tree = [];
      for (const category of categories) {
        const categoryData = category.toJSON();
        categoryData.children = await buildTree(category.id, currentDepth + 1);
        tree.push(categoryData);
      }
      
      return tree;
    };

    return await buildTree();
  }

  /**
   * Get breadcrumb path for a category
   */
  static async getBreadcrumb(categoryId) {
    const breadcrumb = [];
    let currentCategory = await Category.findByPk(categoryId);
    
    while (currentCategory) {
      breadcrumb.unshift({
        id: currentCategory.id,
        name: currentCategory.name,
        slug: currentCategory.slug,
        path: currentCategory.path
      });
      
      if (currentCategory.parent_id) {
        currentCategory = await Category.findByPk(currentCategory.parent_id);
      } else {
        break;
      }
    }
    
    return breadcrumb;
  }

  /**
   * Find or create category by name and parent
   */
  static async findOrCreateByName(name, parentId = null) {
    const slug = this.generateSlug(name);
    let level = 0;
    let path = `/${slug}`;
    
    if (parentId) {
      const parent = await Category.findByPk(parentId);
      if (parent) {
        level = parent.level + 1;
        path = `${parent.path}/${slug}`;
      }
    }
    
    const [category, created] = await Category.findOrCreate({
      where: { 
        name: name.trim(),
        parent_id: parentId 
      },
      defaults: {
        name: name.trim(),
        slug: slug,
        parent_id: parentId,
        level: level,
        path: path,
        is_active: true
      }
    });

    return { category, created };
  }

  /**
   * Get all descendants of a category
   */
  async getDescendants() {
    const descendants = [];
    
    const getChildren = async (categoryId) => {
      const children = await Category.findAll({
        where: { parent_id: categoryId }
      });
      
      for (const child of children) {
        descendants.push(child);
        await getChildren(child.id);
      }
    };
    
    await getChildren(this.id);
    return descendants;
  }

  /**
   * Get all ancestors of a category
   */
  async getAncestors() {
    const ancestors = [];
    let currentCategory = this;
    
    while (currentCategory.parent_id) {
      const parent = await Category.findByPk(currentCategory.parent_id);
      if (parent) {
        ancestors.unshift(parent);
        currentCategory = parent;
      } else {
        break;
      }
    }
    
    return ancestors;
  }

  /**
   * Update product count for this category
   */
  async updateProductCount() {
    const count = await sequelize.models.Product.count({
      where: { category_id: this.id }
    });
    
    this.product_count = count;
    await this.save();
    
    return count;
  }

  /**
   * Move category to new parent
   */
  async moveTo(newParentId) {
    const oldLevel = this.level;
    let newLevel = 0;
    let newPath = `/${this.slug}`;
    
    if (newParentId) {
      const newParent = await Category.findByPk(newParentId);
      if (newParent) {
        newLevel = newParent.level + 1;
        newPath = `${newParent.path}/${this.slug}`;
      }
    }
    
    const levelDiff = newLevel - oldLevel;
    
    // Update this category
    this.parent_id = newParentId;
    this.level = newLevel;
    this.path = newPath;
    await this.save();
    
    // Update all descendants
    if (levelDiff !== 0) {
      const descendants = await this.getDescendants();
      for (const descendant of descendants) {
        descendant.level += levelDiff;
        descendant.path = descendant.path.replace(
          new RegExp(`^${this.path.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`),
          newPath
        );
        await descendant.save();
      }
    }
  }
}

Category.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
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
  parent_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'categories',
      key: 'id'
    }
  },
  level: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  path: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sort_order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  product_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    validate: {
      min: 0
    }
  }
}, {
  sequelize,
  modelName: 'Category',
  tableName: 'categories',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'categories_parent_id_idx',
      fields: ['parent_id']
    },
    {
      name: 'categories_slug_idx',
      fields: ['slug']
    },
    {
      name: 'categories_level_idx',
      fields: ['level']
    },
    {
      name: 'categories_path_idx',
      fields: ['path']
    },
    {
      name: 'categories_active_idx',
      fields: ['is_active']
    },
    {
      name: 'categories_featured_idx',
      fields: ['is_featured']
    },
    {
      name: 'categories_sort_order_idx',
      fields: ['parent_id', 'sort_order']
    }
  ],
  hooks: {
    beforeValidate: (category) => {
      if (category.name && !category.slug) {
        category.slug = Category.generateSlug(category.name);
      }
    }
  }
});

module.exports = Category; 