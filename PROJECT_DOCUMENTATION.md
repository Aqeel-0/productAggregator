# 🚀 AggreMart: Product Aggregator & Comparison Engine

## 📋 **Project Overview**

AggreMart is an intelligent product discovery and comparison engine that aggregates product data from multiple e-commerce platforms (Amazon, Flipkart) and provides a unified interface for users to compare prices, specifications, and availability across different stores.

## 🏗️ **Current Architecture**

### **Database Schema**
```
📊 Database: PostgreSQL with Sequelize ORM
├── brands (id, name, slug, logo_url, created_at, updated_at)
├── categories (id, name, slug, parent_id, created_at, updated_at)
├── products (id, model_name, slug, brand_id, category_id, specifications, launch_date, status, model_number, variant_count, min_price, max_price, avg_price, rating, is_featured)
├── product_variants (id, product_id, sku, name, attributes, images, is_active)
└── listings (id, variant_id, store_name, title, url, price, original_price, discount_percentage, currency, stock_status, rating, review_count, scraped_at, is_active)
```

### **Key Features Implemented**

#### ✅ **Data Collection & Processing**
- **Web Scraping**: Amazon and Flipkart scrapers with rate limiting and anti-detection
- **Data Normalization**: Unified data format across different sources
- **Product Matching**: Fuzzy matching for product identification
- **Variant Management**: Automatic variant creation and attribute handling
- **Price Tracking**: Historical price data and trend analysis

#### ✅ **Database Management**
- **Sequelize ORM**: Full database abstraction with models and associations
- **Migrations**: Version-controlled database schema changes
- **Seeders**: Initial data population for categories and brands
- **Indexes**: Optimized queries with trigram indexes for fuzzy search

#### ✅ **Data Quality**
- **Error Handling**: Comprehensive error management and logging
- **Validation**: Data validation at model and application levels
- **Deduplication**: Smart duplicate detection and merging
- **Data Integrity**: Foreign key constraints and referential integrity

## 🔧 **Current API Status**

### **Existing Endpoints** (Basic Implementation)
```javascript
// Current API Structure (src/api/product-api.js)
GET /api/products          // Get all products with filtering
GET /api/products/:id      // Get specific product by ID
GET /api/brands           // Get all brands
GET /api/compare          // Compare products
GET /api/search           // Search products
```

### **Current Limitations**
- ❌ **Static Data**: Currently loads from JSON files instead of database
- ❌ **No Database Integration**: API doesn't use Sequelize models
- ❌ **Limited Functionality**: Basic filtering only
- ❌ **No Authentication**: No user management
- ❌ **No Caching**: No performance optimization

## 🎯 **Required API Endpoints**

### **1. Product Pages (`/brand/product`)**
```javascript
// Product Detail Page
GET /api/products/:slug                    // Get product by slug
GET /api/products/:slug/variants          // Get all variants for product
GET /api/products/:slug/compare           // Compare variants
GET /api/products/:slug/price-history     // Price history for product
GET /api/products/:slug/specifications    // Detailed specifications
```

### **2. Brand Pages (`/brand`)**
```javascript
// Brand Management
GET /api/brands                           // Get all brands
GET /api/brands/:slug                     // Get brand by slug
GET /api/brands/:slug/products           // Get all products for brand
GET /api/brands/:slug/categories         // Get categories for brand
GET /api/brands/:slug/price-range        // Price range for brand
```

### **3. Category Pages (Hierarchical)**
```javascript
// Category Management
GET /api/categories                       // Get all categories
GET /api/categories/:slug                // Get category by slug
GET /api/categories/:slug/subcategories  // Get subcategories
GET /api/categories/:slug/products       // Get products in category
GET /api/categories/:slug/filters        // Get available filters
```

### **4. Search & Discovery**
```javascript
// Search Functionality
GET /api/search                          // Global search
GET /api/search/suggestions              // Search suggestions
GET /api/search/autocomplete             // Autocomplete
GET /api/search/filters                  // Search filters
```

### **5. Comparison & Analytics**
```javascript
// Product Comparison
GET /api/compare                         // Compare multiple products
GET /api/compare/variants               // Compare variants
GET /api/compare/price-analysis         // Price analysis
GET /api/compare/specifications         // Specification comparison
```

### **6. Store & Listing Management**
```javascript
// Store Information
GET /api/stores                          // Get all stores
GET /api/stores/:name                   // Get store details
GET /api/stores/:name/products          // Get products from store
GET /api/stores/:name/price-comparison  // Store price comparison
```

### **7. User Features**
```javascript
// User Management (Future)
GET /api/user/wishlist                  // User wishlist
POST /api/user/wishlist                 // Add to wishlist
GET /api/user/price-alerts              // Price alerts
POST /api/user/price-alerts             // Set price alert
```

## 🗄️ **Database Queries Needed**

### **Product Detail Page**
```sql
-- Get product with brand, category, variants, and listings
SELECT 
    p.*, b.name as brand_name, c.name as category_name,
    pv.*, l.*
FROM products p
    JOIN brands b ON p.brand_id = b.id
    JOIN categories c ON p.category_id = c.id
    LEFT JOIN product_variants pv ON p.id = pv.product_id
    LEFT JOIN listings l ON pv.id = l.variant_id
WHERE p.slug = :slug
ORDER BY l.price ASC;
```

### **Brand Page**
```sql
-- Get brand with all products and price ranges
SELECT 
    b.*, 
    COUNT(DISTINCT p.id) as product_count,
    MIN(l.price) as min_price,
    MAX(l.price) as max_price,
    AVG(l.price) as avg_price
FROM brands b
    LEFT JOIN products p ON b.id = p.brand_id
    LEFT JOIN product_variants pv ON p.id = pv.product_id
    LEFT JOIN listings l ON pv.id = l.variant_id
WHERE b.slug = :slug
GROUP BY b.id;
```

### **Category Page (Hierarchical)**
```sql
-- Get category with subcategories and products
WITH RECURSIVE category_tree AS (
    SELECT id, name, slug, parent_id, 0 as level
    FROM categories WHERE slug = :slug
    UNION ALL
    SELECT c.id, c.name, c.slug, c.parent_id, ct.level + 1
    FROM categories c
    JOIN category_tree ct ON c.parent_id = ct.id
)
SELECT * FROM category_tree;
```

## 🎨 **Frontend Requirements**

### **1. Product Detail Page (`/brand/product`)**
- **Product Information**: Name, brand, category, specifications
- **Variant Selection**: RAM, storage, color options
- **Price Comparison**: All store prices with best deals highlighted
- **Stock Status**: Availability across stores
- **Price History**: Charts showing price trends
- **Specification Comparison**: Detailed specs table
- **Related Products**: Similar products recommendations

### **2. Brand Page (`/brand`)**
- **Brand Overview**: Logo, description, product count
- **Product Grid**: All products from brand with filtering
- **Price Range**: Min/max prices across all products
- **Category Breakdown**: Products organized by category
- **Popular Products**: Featured or best-selling products

### **3. Category Page (Hierarchical)**
- **Category Tree**: Breadcrumb navigation
- **Subcategories**: Child categories display
- **Product Grid**: Products with advanced filtering
- **Price Filters**: Min/max price sliders
- **Specification Filters**: RAM, storage, brand filters
- **Sort Options**: Price, rating, popularity, date

### **4. Search & Discovery**
- **Global Search**: Search across all products
- **Autocomplete**: Real-time search suggestions
- **Advanced Filters**: Price, brand, specifications
- **Search Results**: Grid/list view with sorting
- **Search Analytics**: Popular searches and trends

## 🔄 **API Implementation Plan**

### **Phase 1: Core Product API**
1. **Database Integration**: Connect API to Sequelize models
2. **Product Endpoints**: Implement product detail and listing endpoints
3. **Search Functionality**: Basic search with database queries
4. **Error Handling**: Comprehensive error responses

### **Phase 2: Brand & Category API**
1. **Brand Management**: Brand listing and detail endpoints
2. **Category Hierarchy**: Category tree and product filtering
3. **Filtering System**: Advanced filtering capabilities
4. **Pagination**: Handle large datasets efficiently

### **Phase 3: Advanced Features**
1. **Comparison API**: Product and variant comparison
2. **Price Analytics**: Price history and trend analysis
3. **Store Integration**: Store-specific endpoints
4. **Caching**: Redis caching for performance

### **Phase 4: User Features**
1. **Authentication**: User registration and login
2. **Wishlist**: User wishlist management
3. **Price Alerts**: Price monitoring and notifications
4. **Personalization**: User preferences and recommendations

## 🛠️ **Technical Stack**

### **Backend**
- **Node.js** with Express.js
- **PostgreSQL** with Sequelize ORM
- **Redis** for caching and sessions
- **JWT** for authentication
- **Winston** for logging
- **Joi** for validation

### **Frontend** (To be implemented)
- **React.js** or **Next.js**
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **React Query** for data fetching
- **Chart.js** for price history charts
- **Framer Motion** for animations

## 📊 **Performance Considerations**

### **Database Optimization**
- **Indexes**: Proper indexing on frequently queried fields
- **Query Optimization**: Efficient joins and subqueries
- **Connection Pooling**: Database connection management
- **Read Replicas**: For high-traffic scenarios

### **API Performance**
- **Caching**: Redis caching for frequently accessed data
- **Pagination**: Efficient pagination for large datasets
- **Rate Limiting**: API rate limiting to prevent abuse
- **CDN**: Static asset delivery optimization

### **Search Optimization**
- **Full-Text Search**: PostgreSQL full-text search capabilities
- **Fuzzy Matching**: Trigram indexes for approximate matching
- **Search Suggestions**: Autocomplete with caching
- **Search Analytics**: Track popular searches and trends

## 🚀 **Next Steps**

### **Immediate Actions**
1. **Refactor API**: Replace static JSON with database queries
2. **Implement Core Endpoints**: Product, brand, and category APIs
3. **Add Search Functionality**: Database-powered search
4. **Set Up Testing**: API testing with Jest and Supertest

### **Short Term (2-4 weeks)**
1. **Complete API**: All required endpoints implemented
2. **Frontend Setup**: React/Next.js project initialization
3. **Basic UI**: Product listing and detail pages
4. **Search Interface**: Search and filtering components

### **Medium Term (1-2 months)**
1. **Advanced Features**: Comparison, analytics, user features
2. **Performance Optimization**: Caching, CDN, database optimization
3. **Mobile Responsiveness**: Mobile-first design
4. **SEO Optimization**: Meta tags, sitemaps, structured data

### **Long Term (3-6 months)**
1. **User Authentication**: Registration, login, profiles
2. **Personalization**: User preferences and recommendations
3. **Advanced Analytics**: User behavior tracking
4. **Mobile App**: React Native or PWA

## 🎯 **Success Metrics**

### **Technical Metrics**
- **API Response Time**: < 200ms for product pages
- **Search Performance**: < 100ms for search queries
- **Database Query Time**: < 50ms for complex queries
- **Uptime**: 99.9% availability

### **User Experience Metrics**
- **Page Load Time**: < 2 seconds for product pages
- **Search Accuracy**: > 90% relevant search results
- **Price Accuracy**: Real-time price updates
- **User Engagement**: Time on site, pages per session


You are tasked with designing a comprehensive REST API for a product aggregator platform. The platform aggregates product data from multiple e-commerce sources (Amazon, Flipkart, more to come) and provides users with product comparison, search, and discovery capabilities.

**Database Schema:**
- brands (id, name, slug, logo_url)
- categories (id, name, slug, parent_id) - hierarchical structure
- products (id, model_name, slug, brand_id, category_id, specifications, price_range)
- product_variants (id, product_id, name, attributes, images)
- listings (id, variant_id, store_name, title, url, price, stock_status, rating)

**Key Requirements:**
1. Product detail pages with variants and price comparison (/brand/product)
2. Brand pages with all products and price ranges (/brand)
3. Hierarchical category pages with filtering (/category/subcategory)
4. Advanced search with autocomplete and filters
5. Product comparison across stores and variants
6. Price history and trend analysis
7. Store-specific product listings

**Technical Constraints:**
- Use Node.js with Express.js
- PostgreSQL with Sequelize ORM
- Implement proper error handling and validation
- Include pagination for large datasets
- Add caching for performance
- Follow RESTful conventions
- Include comprehensive API documentation

**Design the following:**
1. Complete API endpoint structure with HTTP methods
2. Request/response schemas for each endpoint
3. Query parameters for filtering and pagination
4. Error response formats
5. Authentication and authorization (if needed)
6. Rate limiting and caching strategies
7. API documentation format (OpenAPI/Swagger)

Focus on creating a scalable, performant, and user-friendly API that can handle high traffic and provide excellent search and comparison capabilities.
```