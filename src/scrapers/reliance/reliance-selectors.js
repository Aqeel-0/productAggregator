/**
 * Reliance Digital selectors (CSS-based)
 * Placeholder values — fill with real CSS selectors per site structure.
 */

// Category/listing page selectors
const CATEGORY_SELECTORS = {
  PRODUCT_GRID: [
    '/* optional: narrow scope if needed */'
  ],
  PRODUCT_CARD: [
    '/* optional: .product-card */'
  ],
  PRODUCT_LINK: [
    // Reliance Digital product links
  '.product-card-image'
  ],
  NEXT_PAGE: [
    'a[rel="next"]',
    'a.pagination__next',
    'button[aria-label="Next"]'
  ]
};

// Product detail page selectors
const PRODUCT_SELECTORS = {
  TITLE: [
    '.product-name'
  ],
  PRICE: [
    '[itemprop="price"]',
    '.pdp__finalPrice',
    '.price .final',
    '.price-final'
  ],
  ORIGINAL_PRICE: [
    '.price .original',
    '.mrp',
    '.pdp__mrp'
  ],
  DISCOUNT: [
    '.price .discount',
    '.pdp__discount'
  ],
  RATING: [
    '[itemprop="ratingValue"]',
    '.rating .value',
    '.pdp__rating-value'
  ],
  RATING_COUNT: [
    '.rating .count',
    '.pdp__rating-count'
  ],
  IMAGE: [
    '.product-gallery img',
    'img[alt][src]'
  ],
  BRAND: [
    '.brand-name',
    '[itemprop="brand"]'
  ],
  SPECS: {
    'RAM': '.specs .ram',
    'Storage': '.specs .storage',
    'Color': '.specs .color'
  }
};

// Optional: error indicators/placeholders
const ERROR_INDICATORS = {
  CAPTCHA: [
    '/* TODO: .captcha */'
  ],
  NOT_FOUND: [
    '/* TODO: .not-found */'
  ]
};

module.exports = {
  CATEGORY_SELECTORS,
  PRODUCT_SELECTORS,
  ERROR_INDICATORS
};



