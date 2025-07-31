/**
 * Flipkart selectors for web crawling
 * All selectors are defined using XPATH for more precise targeting
 * Generic patterns that work for any product
 */

// Category page selectors
const CATEGORY_SELECTORS = {
  PRODUCT_GRID: '//div[contains(@class, "_1YokD2")]',
  PRODUCT_CARD: '//div[contains(@class, "_2kHMtA")]',
  PRODUCT_LINK: '//a[contains(@class, "CGtC98")]',
  NEXT_PAGE: '//a[span[text()="Next"]]'
};

// Product detail page selectors - Generic patterns for any product
const PRODUCT_SELECTORS = {
  // Product Title - More precise patterns for product titles
  TITLE: [
    "//span[@class='VU-ZEz']",                           // Exact class match
    "//span[contains(@class, 'VU-ZEz')]",                // Partial class match
    "//span[contains(@class, 'VU-') and contains(@class, 'ZEz')]", // Split class match
    "//h1//span[contains(text(), 'GB') and contains(text(), 'RAM')]", // Content-based fallback
    "//span[contains(text(), 'GB') and contains(text(), 'RAM') and string-length(text()) > 20]"
  ],
  
  // Price Information - Updated selectors for better coverage
  PRICE: [
    "(//div[contains(@class, 'Nx9bqj')])[1]",
    "//div[contains(@class, 'CxhGGd')]"
  ],
  // Enhanced ORIGINAL_PRICE selectors - Fixed for null values
  ORIGINAL_PRICE: [
    "//div[@class='yRaY8j A6+E6v']",
    // "//div[contains(@class, 'yRaY8j')]",
    "//div[contains(@class, 'A6+E6v')]"
  ],
  // Enhanced DISCOUNT selectors - Fixed for null values  
  DISCOUNT: [
    "//div[@class='UkUFwK WW8yVX']/span",
    // "//div[contains(@class, 'UkUFwK')]//span",
    // "//span[contains(text(), '% off')]",
    // "//span[contains(text(), 'off')]"
  ],
  
  // Product Rating and Reviews - Generic patterns
  RATING: [
    "(//div[@class='XQDdHH'])[1]",
    "(//span[@class='Y1HWO0']//div[@class='XQDdHH'])[1]",
    "(//div[contains(@class, 'XQDdHH')])[1]",
    "(//span[contains(@id, 'productRating_')]//div[@class='XQDdHH'])[1]"

  ],
  RATING_COUNT: [
    "//span[@class='Wphh3N']//span[contains(text(), 'Ratings')]",
    "//span[contains(text(), 'Ratings') and contains(text(), '&')]",
    "//span[@class='Wphh3N']//span[1]",
    "//span[contains(@class, 'Wphh3N')]//span[contains(text(), 'Ratings')]"
  ],
  
  // Product Images - Generic patterns for product images
  MAIN_IMAGE: [
    "(//img[@loading='eager' and @fetchpriority='high'])[1]"
  ],
  
  // Category/Breadcrumb - Enhanced patterns for proper category extraction
  CATEGORY_BREADCRUMB: [
    '//nav//a[text() != ""]',
    '//div[contains(@class, "_2MUtIa")]//a[text() != ""]',
    '//a[contains(@href, "mobiles") or contains(@href, "electronics")][text() != ""]',
    '//nav[contains(@aria-label, "breadcrumb")]//a',
    '//ol[contains(@class, "breadcrumb")]//a',
    '//div[contains(@class, "breadcrumb")]//a[text() != ""]'
  ],
  
  // Enhanced Specifications - Extract ALL available information
  SPECS_CONTAINER: [
    '//div[contains(text(), "Highlights")]//following-sibling::div',
    '//div[contains(@class, "css-175oi2r")]//div[contains(text(), "RAM | ROM")]/../..',
    '//div[contains(text(), "Other Details")]//following-sibling::div',
    '//div[contains(text(), "Specifications")]//following-sibling::div',
    '//section[contains(@class, "spec")]',
    '//div[contains(@class, "GNDEQ-")]'
  ],
  
  // Comprehensive specs extraction patterns
  ALL_SPECS_SECTIONS: [
    '//div[contains(@class, "GNDEQ-")]',
    '//div[contains(text(), "General")]/following-sibling::div',
    '//div[contains(text(), "Display Features")]/following-sibling::div', 
    '//div[contains(text(), "Os & Processor Features")]/following-sibling::div',
    '//div[contains(text(), "Memory & Storage Features")]/following-sibling::div',
    '//div[contains(text(), "Camera Features")]/following-sibling::div',
    '//div[contains(text(), "Connectivity Features")]/following-sibling::div',
    '//div[contains(text(), "Other Details")]/following-sibling::div',
    '//div[contains(text(), "Battery & Power Features")]/following-sibling::div',
    '//div[contains(text(), "Multimedia Features")]/following-sibling::div',
    '//div[contains(text(), "Dimensions")]/following-sibling::div'
  ],
  
  SPECS_HIGHLIGHTS: [
    '//div[contains(text(), "RAM | ROM")]',
    '//div[contains(text(), "Processor")]', 
    '//div[contains(text(), "Rear Camera")]',
    '//div[contains(text(), "Front Camera")]',
    '//div[contains(text(), "Display")]',
    '//div[contains(text(), "Battery")]',
    '//div[contains(text(), "Network Type")]',
    '//div[contains(text(), "SIM Type")]'
  ],
  SPECS_HIGHLIGHT_LABELS: [
    '//div[contains(@class, "css-1rynq56")][contains(@class, "r-1btoxpd")][contains(@class, "r-1et8rh5")]',
    '//div[contains(@style, "color: rgb(113, 116, 120)")][contains(text(), "RAM") or contains(text(), "Processor") or contains(text(), "Camera") or contains(text(), "Display") or contains(text(), "Battery")]'
  ],
  SPECS_HIGHLIGHT_VALUES: [
    '//div[contains(@class, "css-1rynq56")][contains(@class, "r-1vgyyaa")][contains(@class, "r-1b43r93")]',
    '//div[contains(@style, "color: rgb(17, 17, 18)")][contains(text(), "GB") or contains(text(), "Dimensity") or contains(text(), "MP") or contains(text(), "inch") or contains(text(), "mAh")]'
  ],
  // Look for specific technical values
  MEMORY_SPECS: [
    '//div[contains(text(), "8 GB RAM") or contains(text(), "12 GB RAM")]',
    '//div[contains(text(), "256 GB ROM") or contains(text(), "128 GB ROM")]'
  ],
  PROCESSOR_SPECS: [
    '//div[contains(text(), "Dimensity 7400")]',
    '//div[contains(text(), "Octa Core Processor")]',
    '//div[contains(text(), "2.5 GHz Clock Speed")]'
  ],
  CAMERA_SPECS: [
    '//div[contains(text(), "50MP + 13MP Rear Camera")]',
    '//div[contains(text(), "32MP Front Camera")]'
  ],
  DISPLAY_SPECS: [
    '//div[contains(text(), "6.67 inch")]',
    '//div[contains(text(), "Super HD+ 1.5K Display")]'
  ],
  BATTERY_SPECS: [
    '//div[contains(text(), "5500 mAh Battery")]'
  ],
  
  // Enhanced table structure selectors for comprehensive specs extraction
  SPECS_SECTION: [
    '//div[contains(@class, "GNDEQ-")]',
    '//div[contains(@class, "_1OjC5I")]//div[contains(@class, "GNDEQ-")]',
    '//section[contains(@class, "specifications")]',
    '//div[contains(@id, "specs")]'
  ],
  SPECS_SECTION_TITLE: [
    '//div[contains(@class, "_4BJ2V+")]',
    '//div[contains(@class, "GNDEQ-")]//div[contains(@class, "_4BJ2V+")]',
    '//h3[contains(text(), "Specifications")]',
    '//div[contains(@class, "spec-title")]'
  ],
  SPECS_TABLE: [
    '//table[contains(@class, "_0ZhAN9")]',
    '//div[contains(@class, "GNDEQ-")]//table[contains(@class, "_0ZhAN9")]',
    '//table[contains(@class, "spec-table")]',
    '//div[contains(@class, "spec-table")]'
  ],
  SPECS_ROW: [
    '//tr[contains(@class, "WJdYP6")]',
    '//table[contains(@class, "_0ZhAN9")]//tr',
    '//div[contains(@class, "spec-row")]//tr',
    '//tr[td[2]]'
  ],
  SPECS_KEY: [
    '//td[contains(@class, "+fFi1w")]',
    '//tr//td[1]',
    '//div[contains(@class, "spec-key")]',
    '//th[contains(@class, "spec-label")]'
  ],
  SPECS_VALUE: [
    '//td[contains(@class, "Izz52n")]',
    '//tr//td[2]',
    '//div[contains(@class, "spec-value")]',
    '//td[contains(@class, "spec-data")]'
  ],
  
  // Essential specifications to extract
  ESSENTIAL_SPECS: [
    'Brand', 'Model', 'Model Name', 'Color', 'Colour',
    'RAM', 'Memory', 'Storage', 'ROM', 'Internal Storage',
    'Display', 'Screen Size', 'Battery', 'Processor',
    'Camera', 'Operating System', 'OS', 'Network Type', 'SIM Type'
  ]
};

module.exports = {
  CATEGORY_SELECTORS,
  PRODUCT_SELECTORS
}; 