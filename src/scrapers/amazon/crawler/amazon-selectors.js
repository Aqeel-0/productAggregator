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
    "//div[contains(@class, 's-product-image-container')]//a[contains(@href, '/dp/')]"
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

  DEAL: ['#dealBadgeSupportingText span'],
  
  PRODUCT_NAME: ['#prodDetails h1'],
  
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
  
  // Product overview selectors - UPDATED based on actual Amazon HTML structure
  PRODUCT_OVERVIEW_TABLE: '//div[@id="productOverview_feature_div"]//table',
  PRODUCT_OVERVIEW_TABLE_ALT: '#productOverview_feature_div table.a-normal.a-spacing-micro',
  PRODUCT_OVERVIEW_ROW: './/tr[contains(@class, "a-spacing-small")]',
  PRODUCT_OVERVIEW_KEY: './/td[contains(@class, "a-span3")]//span[contains(@class, "a-text-bold")]',
  PRODUCT_OVERVIEW_VALUE: './/td[contains(@class, "a-span9")]//span[contains(@class, "po-break-word")]',
  
  // Technical specifications selectors - UPDATED based on actual Amazon HTML structure
  TECH_SPEC_TABLES: [
    '#productDetails_expanderTables_depthLeftSections table.a-keyvalue.prodDetTable',
    '#productDetails_expanderTables_depthRightSections table.a-keyvalue.prodDetTable',
    '#prodDetails table.a-keyvalue.prodDetTable',
    '//table[contains(@class, "prodDetTable")]',
    '#productDetails_techSpec_section_1',
    '#productDetails_detailBullets_sections1',
    '#detailBulletsWrapper_feature_div'
  ],
  TECH_SPEC_TABLE: 'table.a-keyvalue.prodDetTable',
  TECH_SPEC_ROW: 'tr',
  TECH_SPEC_KEY: 'th.prodDetSectionEntry',
  TECH_SPEC_VALUE: 'td.prodDetAttrValue',

  // Expandable Product Detail Sections (Camera, Battery, Measurements, etc.)
  // Left and right column containers
  EXPANDER_LEFT_SECTIONS: '#productDetails_expanderTables_depthLeftSections',
  EXPANDER_RIGHT_SECTIONS: '#productDetails_expanderTables_depthRightSections',

  // Individual expandable section containers
  EXPANDER_SECTION: '.a-expander-container.a-section-expander-container',

  // Section heading/title (e.g., "Camera", "Battery")
  EXPANDER_SECTION_TITLE: '.a-expander-prompt',

  // Section content table within each expander
  EXPANDER_SECTION_TABLE: '.a-expander-content table.a-keyvalue.prodDetTable',

  // Key-value pairs within expander tables
  EXPANDER_KEY: 'th.prodDetSectionEntry',
  EXPANDER_VALUE: 'td.prodDetAttrValue',
  
  // Detail bullets selectors - UPDATED
  DETAIL_BULLETS: [
    '#detailBullets_feature_div',
    '#productDetails_expanderSectionTables'
  ],
  DETAIL_BULLETS_ITEM: 'li, tr',
  
  // Feature bullets selectors - UPDATED based on actual Amazon HTML structure
  FEATURE_BULLETS: [
    '#feature-bullets',
    '#featurebullets_feature_div',
    '[data-feature-name="featurebullets_nonPets"]'
  ],
  FEATURE_BULLETS_ITEM: 'ul.a-unordered-list li span.a-list-item',
  FEATURE_BULLETS_LIST: 'ul.a-unordered-list.a-vertical.a-spacing-mini',
  
  // Product description selectors
  PRODUCT_DESCRIPTION: [
    '//div[@id="productDescription"]',
    '//div[@id="aplus"]',
    '//div[contains(@class, "a-section") and contains(@class, "a-spacing-medium")]//p'
  ],
  
  // About this item section - Same as feature bullets
  ABOUT_THIS_ITEM: '#feature-bullets',
  ABOUT_THIS_ITEM_BULLET: 'ul.a-unordered-list li span.a-list-item',
  
  // Breadcrumb/Category XPaths - UPDATED
  BREADCRUMB: [
    '#wayfinding-breadcrumbs_container a',
    '.a-breadcrumb a',
    '.a-breadcrumb li a',
    'nav[aria-label="Breadcrumb"] a',
    '[data-testid="breadcrumbs-list"] a'
  ],
  
  // Seller information - UPDATED
  SELLER_INFO: [
    '#merchant-info span',
    '#tabular-buybox span',
    '[data-hook="merchant"]',
    '.tabular-buybox span'
  ],
  SOLD_BY: '#merchant-info a[href*="seller"]',
  SHIPS_FROM: '#merchant-info span:contains("Ships from")'
};

// Error indicators for debugging - UPDATED
const ERROR_INDICATORS = {
  // CAPTCHA detection
  CAPTCHA: [
    'form[action*="/errors/validateCaptcha"]',
    'img[src*="captcha"]',
    '#captchacharacters',
    '.a-section:contains("Enter the characters you see below")'
  ],

  // Access denied
  ACCESS_DENIED: [
    '.a-section:contains("Access Denied")',
    'body:contains("Access to this page has been denied")'
  ],

  // Not found
  NOT_FOUND: [
    '.a-section:contains("Page Not Found")',
    '#noResultsTitle',
    'body:contains("404")'
  ]
};

module.exports = { CATEGORY_SELECTORS, PRODUCT_SELECTORS, ERROR_INDICATORS };