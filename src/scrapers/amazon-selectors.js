/**
 * Amazon selectors for web crawling
 * All selectors are defined using XPATH for more precise targeting
 */

// Category page selectors
const CATEGORY_SELECTORS = {
  PRODUCT_GRID: '//div[contains(@class, "s-main-slot") and contains(@class, "s-result-list")]',
  PRODUCT_CARD: '//div[contains(@class, "s-result-item") and @data-asin and @data-asin!=""]',
  PRODUCT_LINK: '//a[contains(@class, "a-link-normal") and contains(@class, "s-no-outline")]',
  PAGINATION: '//ul[contains(@class, "a-pagination")]',
  NEXT_PAGE: '//a[contains(@class, "s-pagination-next")]'
};

// Product detail page selectors
const PRODUCT_SELECTORS = {
  // Title selectors
  TITLE: [
    '//span[@id="productTitle"]',
    '//h1[contains(@class, "product-title-word-break")]',
    '//h1[contains(@class, "a-size-large")]'
  ],
  
  // Product overview selectors
  PRODUCT_OVERVIEW_TABLE: '//div[@id="productOverview_feature_div"]//table',
  PRODUCT_OVERVIEW_ROW: './/tr',
  PRODUCT_OVERVIEW_KEY: './/td[1]//span',
  PRODUCT_OVERVIEW_VALUE: './/td[2]//span',
  
  // Technical specifications selectors
  TECH_SPEC_TABLES: [
    '//table[@id="productDetails_techSpec_section_1"]',
    '//table[@id="productDetails_detailBullets_sections1"]',
    '//div[@id="detailBulletsWrapper_feature_div"]',
    '//div[contains(@class, "detail-bullets-wrapper")]',
    '//div[@id="prodDetails"]//table[contains(@class, "prodDetTable")]',
    '//div[@id="technicalSpecifications_section_1"]'
  ],
  TECH_SPEC_ROW: './/tr | .//div[contains(@class, "a-spacing-micro")]',
  TECH_SPEC_KEY: './/th | .//span[contains(@class, "a-text-bold")]',
  TECH_SPEC_VALUE: './/td | .//span[contains(@class, "a-size-base")]',
  
  // Detail bullets selectors
  DETAIL_BULLETS: '//div[@id="detailBullets_feature_div"]',
  DETAIL_BULLETS_ITEM: './/li',
  
  // Feature bullets selectors
  FEATURE_BULLETS: '//div[@id="feature-bullets"]',
  FEATURE_BULLETS_ITEM: './/li',
  
  // Product description selectors
  PRODUCT_DESCRIPTION: '//div[@id="productDescription"]',
  
  // About this item section
  ABOUT_THIS_ITEM: '//div[@id="feature-bullets"]',
  ABOUT_THIS_ITEM_BULLET: './/li/span'
};

module.exports = {
  CATEGORY_SELECTORS,
  PRODUCT_SELECTORS
}; 