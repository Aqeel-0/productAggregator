/**
 * Chrome (Croma) selectors (CSS-based)
 * Placeholder values — fill with real CSS selectors per site structure.
 */

// Category/listing page selectors
const CATEGORY_SELECTORS = {
  PRODUCT_GRID: [
    '/* TODO: .product-grid */'
  ],
  PRODUCT_CARD: [
    '/* TODO: .product-card */'
  ],
  PRODUCT_LINK: [
    '.product-item a',
    '.product-card a',
    '.plp-product-tile a',
    '.product-tile a',
    'a[href*="/product/"]',
    'a[href*="/p/"]',
    '.product-list-item a',
    '.product-grid-item a'
  ],
  NEXT_PAGE: [
    '/* TODO: a.next', '/* TODO: button.next */'
  ],
  VIEW_MORE_BUTTON: [
    '.btn-viewmore',
    '.view-more-div button',
    'button[class*="viewmore"]',
    'button[class*="view-more"]',
    'button:contains("View More")',
    'button:contains("Load More")',
    'button:contains("Show More")'
  ]
};

// Product detail page selectors
const PRODUCT_SELECTORS = {
  TITLE: [
    'h1.pd-title',
  ],
  PRICE: [
    'span#pdp-product-price'
  ],
  ORIGINAL_PRICE: [
    'span#old-price'
  ],
  DISCOUNT: [
    '/* TODO: .price .discount */'
  ],
  RATING: [
    '/* TODO: .rating .value */'
  ],
  RATING_COUNT: [
    '/* TODO: .rating .count */'
  ],
  MAIN_IMAGE: [
    'img#1prod_img'
  ],
  IMAGE: [
    'img[data-testid^="galary-thumb-img-"]'
  ],
  BRAND: [
    '/* TODO: .brand-name */'
  ],
  SPECS: {
    '/* TODO: RAM */': '/* TODO: .specs .ram */',
    '/* TODO: Storage */': '/* TODO: .specs .storage */',
    '/* TODO: Color */': '/* TODO: .specs .color */'
  }
};

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



