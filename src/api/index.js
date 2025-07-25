const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { createLogger } = require('../utils/logger');
const productRoutes = require('./product-api');

const logger = createLogger('API');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Register routes
app.use('/api', productRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Product Aggregator API',
    endpoints: {
      products: '/api/products',
      product: '/api/products/:id',
      brands: '/api/brands',
      compare: '/api/compare?ids=0,1,2',
      search: '/api/search?q=keyword'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

module.exports = app; 