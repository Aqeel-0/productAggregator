const express = require('express');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');

const router = express.Router();
const logger = createLogger('ProductAPI');

// Path to the unified normalized data
const dataPath = path.join(__dirname, '../scrapers/unified_normalized_data.json');

// Helper function to load data
const loadData = () => {
  try {
    if (fs.existsSync(dataPath)) {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      return data;
    }
    logger.warn(`Data file not found at ${dataPath}`);
    return [];
  } catch (error) {
    logger.error(`Error loading data: ${error.message}`);
    return [];
  }
};

// GET /api/products - Get all products with optional filtering
router.get('/products', (req, res) => {
  try {
    const products = loadData();
    
    // Apply filters if provided
    let filteredProducts = [...products];
    
    // Filter by brand
    if (req.query.brand) {
      const brandFilter = req.query.brand.toLowerCase();
      filteredProducts = filteredProducts.filter(product => 
        product.brand.toLowerCase().includes(brandFilter)
      );
    }
    
    // Filter by model
    if (req.query.model) {
      const modelFilter = req.query.model.toLowerCase();
      filteredProducts = filteredProducts.filter(product => 
        product.model.toLowerCase().includes(modelFilter)
      );
    }
    
    // Filter by min price
    if (req.query.minPrice) {
      const minPrice = parseFloat(req.query.minPrice);
      if (!isNaN(minPrice)) {
        filteredProducts = filteredProducts.filter(product => {
          // Find the lowest price among all sources
          const prices = product.sources
            .map(source => source.price)
            .filter(price => price !== null && !isNaN(price));
          
          if (prices.length === 0) return false;
          return Math.min(...prices) >= minPrice;
        });
      }
    }
    
    // Filter by max price
    if (req.query.maxPrice) {
      const maxPrice = parseFloat(req.query.maxPrice);
      if (!isNaN(maxPrice)) {
        filteredProducts = filteredProducts.filter(product => {
          // Find the lowest price among all sources
          const prices = product.sources
            .map(source => source.price)
            .filter(price => price !== null && !isNaN(price));
          
          if (prices.length === 0) return false;
          return Math.min(...prices) <= maxPrice;
        });
      }
    }
    
    // Filter by RAM
    if (req.query.ram) {
      const ramFilter = parseInt(req.query.ram);
      if (!isNaN(ramFilter)) {
        filteredProducts = filteredProducts.filter(product => {
          return product.variants.some(variant => variant.ram_gb === ramFilter);
        });
      }
    }
    
    // Filter by storage
    if (req.query.storage) {
      const storageFilter = parseInt(req.query.storage);
      if (!isNaN(storageFilter)) {
        filteredProducts = filteredProducts.filter(product => {
          return product.variants.some(variant => variant.storage_gb === storageFilter);
        });
      }
    }
    
    // Filter by color
    if (req.query.color) {
      const colorFilter = req.query.color.toLowerCase();
      filteredProducts = filteredProducts.filter(product => {
        return product.variants.some(variant => 
          variant.color && variant.color.toLowerCase().includes(colorFilter)
        );
      });
    }
    
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    
    const paginatedProducts = filteredProducts.slice(startIndex, endIndex);
    
    res.json({
      total: filteredProducts.length,
      page,
      limit,
      products: paginatedProducts
    });
  } catch (error) {
    logger.error(`Error in GET /products: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/:id - Get a specific product by ID (index)
router.get('/products/:id', (req, res) => {
  try {
    const products = loadData();
    const id = parseInt(req.params.id);
    
    if (isNaN(id) || id < 0 || id >= products.length) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json(products[id]);
  } catch (error) {
    logger.error(`Error in GET /products/:id: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/brands - Get all unique brands
router.get('/brands', (req, res) => {
  try {
    const products = loadData();
    const brands = [...new Set(products.map(product => product.brand))];
    res.json(brands);
  } catch (error) {
    logger.error(`Error in GET /brands: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/compare - Compare products by IDs
router.get('/compare', (req, res) => {
  try {
    const products = loadData();
    const ids = req.query.ids?.split(',').map(id => parseInt(id)) || [];
    
    if (!ids.length) {
      return res.status(400).json({ error: 'No product IDs provided for comparison' });
    }
    
    const comparisonProducts = ids
      .filter(id => !isNaN(id) && id >= 0 && id < products.length)
      .map(id => products[id]);
    
    res.json(comparisonProducts);
  } catch (error) {
    logger.error(`Error in GET /compare: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/search - Search products by keyword
router.get('/search', (req, res) => {
  try {
    const products = loadData();
    const keyword = req.query.q?.toLowerCase() || '';
    
    if (!keyword) {
      return res.status(400).json({ error: 'No search keyword provided' });
    }
    
    const searchResults = products.filter(product => {
      // Search in brand and model
      if (product.brand.toLowerCase().includes(keyword) || 
          product.model.toLowerCase().includes(keyword)) {
        return true;
      }
      
      // Search in variant attributes
      for (const variant of product.variants) {
        if (variant.color && variant.color.toLowerCase().includes(keyword)) {
          return true;
        }
        
        // Search in specifications
        if (variant.specifications) {
          for (const [key, value] of Object.entries(variant.specifications)) {
            if (value && value.toString().toLowerCase().includes(keyword)) {
              return true;
            }
          }
        }
      }
      
      return false;
    });
    
    res.json({
      total: searchResults.length,
      results: searchResults
    });
  } catch (error) {
    logger.error(`Error in GET /search: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 