const { sequelize } = require('../../config/sequelize');

// Import all models
const Brand = require('./Brand');
const Category = require('./Category');
const Product = require('./Product');
const ProductVariant = require('./ProductVariant');
const Listing = require('./Listing');

// Store models in an object for easy access
const models = {
  Brand,
  Category,
  Product,
  ProductVariant,
  Listing
};

// Set up associations
Object.keys(models).forEach(modelName => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

// Add models to sequelize instance for easier access
sequelize.models = models;

module.exports = {
  sequelize,
  ...models
}; 