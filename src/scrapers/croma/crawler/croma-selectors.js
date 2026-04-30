const CATEGORY_SELECTORS = {
  PRODUCT_LINK: [
    '.product-item a',
    '.product-card a',
    '.plp-product-tile a',
    '.product-tile a',
    'a[href*="/p/"]',
    '.product-list-item a',
    '.product-grid-item a'
  ],
  VIEW_MORE_BUTTON: [
    '.btn-viewmore',
    '.view-more-div button',
    'button[class*="viewmore"]',
    'button[class*="view-more"]'
  ]
};

const PRODUCT_SELECTORS = {
  TITLE: ['h1.pd-title'],
  PRICE: ['span#pdp-product-price'],
  ORIGINAL_PRICE: ['span#old-price'],
  MAIN_IMAGE: ['img#1prod_img'],
  IMAGE: ['img[data-testid^="galary-thumb-img-"]']
};

const ERROR_INDICATORS = {
  CAPTCHA: [],
  ACCESS_DENIED: [],
  NOT_FOUND: []
};

module.exports = {
  CATEGORY_SELECTORS,
  PRODUCT_SELECTORS,
  ERROR_INDICATORS
};
