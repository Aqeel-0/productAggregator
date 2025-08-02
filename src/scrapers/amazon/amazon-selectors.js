/**
 * Amazon selectors for web crawling
 * All selectors are defined using XPATH for more precise targeting
 * Enhanced with price, rating, and image selectors
 */

// Category page selectors
const CATEGORY_SELECTORS = {
  PRODUCT_GRID: '//div[contains(@class, "s-main-slot") and contains(@class, "s-result-list")]',
  PRODUCT_CARD: '//div[contains(@class, "s-result-item") and @data-asin and @data-asin!=""]',
  PRODUCT_LINK: [
    '//a[contains(@href, "/dp/")]',
    '//a[contains(@href, "/gp/product/")]'
  ],
  PAGINATION: '//ul[contains(@class, "a-pagination")]',
  NEXT_PAGE: '//a[contains(@class, "s-pagination-next")]'
};

// Product detail page selectors
const PRODUCT_SELECTORS = {
  // Title extraction XPaths - ADD YOUR XPATHS HERE
  TITLE: [
    'h1#title #productTitle',        
    '#productTitle',                  
    'h1#title',                        
    '#titleSection h1',              
    '.product-title-word-break'   
  ],

  PRODUCT_NAME: ['#prodDetails h2'],
  
  PRICE: [
    "#corePriceDisplay_desktop_feature_div .priceToPay .a-price-whole", // The most specific path to the final price.
    "#corePriceDisplay_desktop_feature_div .a-price-whole"             // A strong fallback within the same container.
  ],

  // --- Original Price (M.R.P.) Selectors ---
  // Anchored to the parent and prioritizing the data-attribute selector.
  ORIGINAL: [
    "#corePriceDisplay_desktop_feature_div span[data-a-strike='true'] .a-offscreen", // Highly reliable.
    "#corePriceDisplay_desktop_feature_div .basisPrice .a-text-price .a-offscreen", // Good structural fallback.
    "span[data-a-strike='true']" // Generic fallback if the container ID changes.
  ],

  // --- Discount Percentage Selectors ---
  // Already quite specific, but we'll anchor it for consistency.
  DISCOUNT: [
    "#corePriceDisplay_desktop_feature_div span[class*='savingsPercentage']", // Best option.
    ".savingsPercentage" // Fallback if the parent container is not found.
  ],
  
  // Rating XPaths - ADD YOUR XPATHS HERE
  RATING: [
    "#averageCustomerReviews .a-popover-trigger .a-size-base.a-color-base",  // Most specific
    "#acrPopover .a-popover-trigger .a-size-base",                           // Good fallback
    ".a-popover-trigger .a-size-base.a-color-base",                          // Generic fallback
    ".a-icon-alt"        
  ],
  
  // Rating count XPaths - ADD YOUR XPATHS HERE
  RATING_COUNT: [
    "#acrCustomerReviewText",                                                 // Most reliable using ID
    "#acrCustomerReviewLink .a-size-base",                                   // Good structural fallback
    "span[aria-label*='Reviews']",                                            // Using aria-label attribute
    ".a-size-base[aria-label*='ratings']"      
  ],
  
  // Main image XPaths - ADD YOUR XPATHS HERE
  MAIN_IMAGE: [
    '#landingImage', '.a-dynamic-image', '#imageBlock img', '.imgTagWrapper img'
  ],
  OTHER_IMAGES: [
    "li.imageThumbnail .a-button-text img"
  ],
  
  // Availability XPaths - ADD YOUR XPATHS HERE
  AVAILABILITY: [
    '#availability span', '.a-color-success', '.a-color-state', '[data-feature-name="availability"] span'
  ],
  
  // Product overview selectors
  PRODUCT_OVERVIEW_TABLE: '//div[@id="productOverview_feature_div"]//table',
  PRODUCT_OVERVIEW_ROW: './/tr',
  PRODUCT_OVERVIEW_KEY: './/td[1]//span',
  PRODUCT_OVERVIEW_VALUE: './/td[2]//span',
  
  // Technical specifications selectors - Enhanced
  TECH_SPEC_TABLES: [
    '//table[@id="productDetails_techSpec_section_1"]',
    '//table[@id="productDetails_detailBullets_sections1"]',
    '//div[@id="detailBulletsWrapper_feature_div"]',
    '//div[contains(@class, "detail-bullets-wrapper")]',
    '//div[@id="prodDetails"]//table[contains(@class, "prodDetTable")]',
    '//div[@id="technicalSpecifications_section_1"]',
    '//div[@id="productDetails_expanderTables_depthLeftSections"]//table'
  ],
  TECH_SPEC_ROW: './/tr | .//div[contains(@class, "a-spacing-micro")]',
  TECH_SPEC_KEY: './/th | .//span[contains(@class, "a-text-bold")] | .//td[1]',
  TECH_SPEC_VALUE: './/td | .//span[contains(@class, "a-size-base")] | .//td[2]',
  
  // Detail bullets selectors
  DETAIL_BULLETS: '//div[@id="detailBullets_feature_div"]',
  DETAIL_BULLETS_ITEM: './/li',
  
  // Feature bullets selectors
  FEATURE_BULLETS: '//div[@id="feature-bullets"]',
  FEATURE_BULLETS_ITEM: './/li',
  
  // Product description selectors
  PRODUCT_DESCRIPTION: [
    '//div[@id="productDescription"]',
    '//div[@id="aplus"]',
    '//div[contains(@class, "a-section") and contains(@class, "a-spacing-medium")]//p'
  ],
  
  // About this item section
  ABOUT_THIS_ITEM: '//div[@id="feature-bullets"]',
  ABOUT_THIS_ITEM_BULLET: './/li/span',
  
  // Breadcrumb/Category XPaths - ADD YOUR XPATHS HERE
  BREADCRUMB: [
    '//PLACEHOLDER_XPATH_1',
    '//PLACEHOLDER_XPATH_2',
    '//PLACEHOLDER_XPATH_3'
  ],
  
  // Seller information - NEW
  SELLER_INFO: [
    '//div[@id="merchant-info"]//span',
    '//span[contains(text(), "Ships from") or contains(text(), "Sold by")]',
    '//div[contains(@class, "tabular-buybox")]//span[contains(text(), "Amazon") or contains(text(), "Seller")]'
  ]
};

// Error indicators for debugging
const ERROR_INDICATORS = {
  // CAPTCHA detection XPaths - ADD YOUR XPATHS HERE
  CAPTCHA: [
    '//PLACEHOLDER_XPATH_1',
    '//PLACEHOLDER_XPATH_2'
  ],
  
  // Access denied XPaths - ADD YOUR XPATHS HERE
  ACCESS_DENIED: [
    '//PLACEHOLDER_XPATH_1',
    '//PLACEHOLDER_XPATH_2'
  ],
  
  // Not found XPaths - ADD YOUR XPATHS HERE
  NOT_FOUND: [
    '//PLACEHOLDER_XPATH_1',
    '//PLACEHOLDER_XPATH_2'
  ]
};

module.exports = { CATEGORY_SELECTORS, PRODUCT_SELECTORS, ERROR_INDICATORS }; 