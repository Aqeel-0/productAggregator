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
    // Reliance Digital product links - captures all product links
    'a[href*="/product/"]'
  ],
  NEXT_PAGE: [
    'span[aria-label="Goto Next Page"]', // Primary arrow button selector
    'span[aria-label="Goto Next Page"] img.rotation', // Alternative selector for the arrow image
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
    '.product-price'
  ],
  ORIGINAL_PRICE: [
    '.product-marked-price',
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
    '.load-image img',
  ],
  ALT_IMAGE: [
    '.image-gallery__list--item',
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



