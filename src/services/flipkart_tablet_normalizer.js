const fs = require('fs');
const path = require('path');

// Try to import logger, fall back to console if not available
let logger;
try {
  logger = require('../utils/logger');
} catch (e) {
  logger = console;
}

class FlipkartTabletNormalizer {
  constructor() {
    this.logger = logger;
  }

  /**
   * Normalize array of Flipkart tablet scraped products
   */
  normalizeProducts(products) {
    const normalized = [];
    let skippedCount = 0;
    
    for (const product of products) {
      try {
        const normalizedProduct = this.normalizeProduct(product);
        normalized.push(normalizedProduct);
      } catch (error) {
        skippedCount++;
      }
    }
    
    if (skippedCount > 0) {
      console.log(`Skipped ${skippedCount} non-tablet products`);
    }
    
    return normalized;
  }

  /**
   * Normalize single Flipkart tablet product to exact output format
   */
  normalizeProduct(product) {
    // Skip products with null or empty title (corrupted data)
    if (!product.title || product.title.trim() === '') {
      throw new Error('Product has null or empty title - skipping');
    }
    
    // Only keep tablets - check if third element in category is "Tablets"
    if (!product.category || !Array.isArray(product.category) || product.category[2] !== "Tablets") {
      throw new Error('Product is not a tablet - skipping');
    }
    
    const specs = product.specifications || {};
    
    // Store current title for fallback extractions
    this.currentTitle = product.title;

    return {
      source_details: {
        source_name: "flipkart",
        url: product.url || null,
        scraped_at_utc: new Date().toISOString()
      },
      
      product_identifiers: {
        brand: this.extractBrand(product),
        model_name: this.extractModelName(product),
        original_title: product.title || null,
        model_number: this.extractModelNumber(specs)
      },

      category: this.extractCategory(product),
      
      variant_attributes: {
        color: this.extractColor(specs),
        ram: this.extractRAM(specs),
        storage: this.extractStorage(specs),
        display_size: this.extractDisplaySize(specs),
        connectivity_type: this.extractConnectivityType(product)
      },
      
      listing_info: {
        price: this.normalizePrice(product.price),
        rating: this.normalizeRating(product.rating),
        image_url: this.processFlipkartImage(product.image),
        image_urls: this.processFlipkartImages(product.images, product.image),
        availability: product.availability || null
      },
      
      key_specifications: {
        display: this.extractDisplaySpecs(specs),
        performance: this.extractPerformanceSpecs(specs),
        camera: this.extractCameraSpecs(specs),
        battery: this.extractBatterySpecs(specs),
        connectivity: this.extractConnectivitySpecs(specs),
        design: this.extractDesignSpecs(specs)
      },
      
      source_metadata: {
        category_breadcrumb: this.generateCategoryBreadcrumb(product)
      }
    };
  }

  generateCategoryBreadcrumb(product) {
    // Since we're filtering out laptops, all remaining products are tablets
    return ["Electronics", "Mobiles & Accessories", "Tablets"];
  }

  /**
   * Extract category from breadcrumb
   */
  extractCategory(product) {
    const breadcrumb = this.generateCategoryBreadcrumb(product);
    // For tablets, use breadcrumb[2] (index 2)
    return breadcrumb[2] || null;
  }

  extractBrand(product) {
    // First check title for Apple products specifically
    if (product.title && product.title.toLowerCase().includes('apple')) {
      return 'Apple';
    }

    // First try from category
    if (product.category && Array.isArray(product.category) && product.category[3]) {
      const brandCategory = product.category[3];
      // Clean up brand name for tablet categories
      const brand = brandCategory
        .replace(/\s+Tablets?$/i, '')
        .replace(/\s+without Call Facility$/i, '')
        .replace(/\s+Laptops?$/i, '')
        .trim();
    
      if(brand && !brand.toLowerCase().includes('tablet') && !brand.toLowerCase().includes('laptop')) {
        return brand;
      }
    }
    
    // Fallback to title extraction - first word approach
    if (product.title) {
      const firstWord = product.title.split(' ')[0]
        .replace(/[^a-zA-Z0-9]/g, '') // Remove special characters
        .trim();
      
      // If we have a valid first word, return it as brand name
      if (firstWord && firstWord.length > 0) {
        // Normalize the brand name (capitalize first letter)
        return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
      }
    }
    
    return null;
  }

  extractModelName(product) {
    // Try from specifications first
    const general = product.specifications?.["General"];
    if (general && general["Model Name"]) {
      return general["Model Name"];
    }
    
    // Fallback to title extraction
    if (product.title) {
      const title = product.title.toLowerCase();
      
      // Remove brand names and common words
      let modelName = product.title;
      modelName = modelName.replace(/^(apple|samsung|xiaomi|mi|dell|lenovo|hp|asus|acer|realme|oneplus|oppo|vivo)\s+/i, '');
      modelName = modelName.replace(/\s+(tablet|laptop|pad|tab|ipad).*$/i, '');
      modelName = modelName.replace(/\s*\([^)]*\)\s*$/g, ''); // Remove parentheses at end
      modelName = modelName.replace(/\s+\d+\s*gb\s*ram.*$/i, ''); // Remove RAM info
      modelName = modelName.replace(/\s+\d+\s*gb\s*rom.*$/i, ''); // Remove storage info
      modelName = modelName.replace(/\s+\d+\.\d+\s*inch.*$/i, ''); // Remove screen size
      modelName = modelName.replace(/\s+wi-fi\s+only.*$/i, ''); // Remove connectivity info
      
      return modelName.trim() || null;
    }
    
    return null;
  }

  extractModelNumber(specs) {
    if (specs.General && specs.General['Model Number']) {
      return specs.General['Model Number'];
    }
    return null;
  }

  /**
   * Extract color from specifications
   */
  extractColor(specs) {
    if (specs.General && specs.General['Color']) {
      return specs.General['Color'];
    }
    return null;
  }

  /**
   * Extract RAM information - tablet specific paths
   */
  extractRAM(specs) {
    // Try multiple paths for RAM extraction (tablet specific)
    const ramPaths = [
      specs['General']?.['RAM'], // Primary path for tablets
      specs['Processor And Memory Features']?.['RAM'] // For laptops in mixed data
    ];
    
    for (const ramStr of ramPaths) {
      if (ramStr) {
        const match = ramStr.match(/(\d+(?:\.\d+)?)\s*GB/i);
        if (match) {
          const ramValue = parseFloat(match[1]);
          // Skip 0.0 GB RAM (common for iPads)
          if (ramValue > 0) {
            return Math.round(ramValue);
          }
        }
      }
    }
    
    // Fallback: try to extract from title
    if (this.currentTitle) {
      let titleMatch = this.currentTitle.match(/\(\s*(\d+)\s*GB\s+RAM\s*\)/i);
      if (titleMatch) {
        return parseInt(titleMatch[1]);
      }
    }
    
    return null;
  }

  /**
   * Extract storage information - tablet specific paths
   */
  extractStorage(specs) {
    // Try multiple paths for storage extraction (tablet specific)
    const storagePaths = [
      specs['Product Details']?.['Internal Storage'], // Primary path for tablets
      specs['Processor And Memory Features']?.['SSD Capacity'] // For laptops in mixed data
    ];
    
    for (const storageStr of storagePaths) {
      if (storageStr) {
        // Try TB format first
        let match = storageStr.match(/(\d+)\s*TB/i);
        if (match) {
          // Convert TB to GB (multiply by 1024)
          return parseInt(match[1]) * 1024;
        }
        
        // Try GB format
        match = storageStr.match(/(\d+)\s*GB/i);
        if (match) {
          return parseInt(match[1]);
        }
      }
    }
    
    // Fallback: try to extract from title
    if (this.currentTitle) {
      // Try pattern: "16 GB RAM 2 TB ROM" (no comma, TB format)
      let titleMatch = this.currentTitle.match(/(\d+)\s*GB\s*RAM\s+(\d+)\s*TB\s*ROM/i);
      if (titleMatch) {
        // Convert TB to GB (multiply by 1024)
        return parseInt(titleMatch[2]) * 1024;
      }
      
      // Try pattern: "16 GB RAM 128 GB ROM" (no comma, GB format)
      titleMatch = this.currentTitle.match(/(\d+)\s*GB\s*RAM\s+(\d+)\s*GB\s*ROM/i);
      if (titleMatch) {
        return parseInt(titleMatch[2]);
      }
      
      // Try pattern: ", 128 GB ROM)" (with comma, GB format)
      titleMatch = this.currentTitle.match(/,\s*(\d+)\s*GB\s*ROM\s*\)/i);
      if (titleMatch) {
        return parseInt(titleMatch[1]);
      }
      
      // Try pattern: ", 2 TB ROM)" (with comma, TB format)
      titleMatch = this.currentTitle.match(/,\s*(\d+)\s*TB\s*ROM\s*\)/i);
      if (titleMatch) {
        // Convert TB to GB (multiply by 1024)
        return parseInt(titleMatch[1]) * 1024;
      }
    }

    return null;
  }

  /**
   * Extract display size in inches
   */
  extractDisplaySize(specs) {
    const displaySize = specs['Product Details']?.['Display Size'];
    if (!displaySize) return null;
    
    // Extract inch value from parentheses (more reliable)
    const inchMatch = displaySize.match(/\((\d+\.?\d*)\s*inch\)/i);
    if (inchMatch) {
      const size = parseFloat(inchMatch[1]);
      // Filter unrealistic sizes
      if (size >= 6 && size <= 15) {
        return Math.round(size * 10) / 10; // Round to 1 decimal
      }
    }
    
    // Fallback: extract any numeric value and convert if needed
    const match = displaySize.match(/(\d+\.?\d*)/);
    if (!match) return null;
    
    let size = parseFloat(match[1]);
    
    // Convert cm to inches if needed
    if (displaySize.toLowerCase().includes('cm') && !displaySize.toLowerCase().includes('inch')) {
      size = size / 2.54;
    }
    
    // Filter unrealistic sizes
    if (size < 6 || size > 15) return null;
    
    return Math.round(size * 10) / 10; // Round to 1 decimal
  }

  /**
   * Extract connectivity type - primary from connectivity specs, fallback to category
   */
  extractConnectivityType(product) {
    const specs = product.specifications || {};
    
    // Primary method: Use connectivity.type field from specs
    const connectivityType = specs['General']?.['Connectivity'];
    if (connectivityType) {
      // Map specific connectivity types
      switch (connectivityType) {
        case 'Wi-Fi+5G':
          return 'Wi-Fi+5G';
        case 'Wi-Fi+4G':
          return 'Wi-Fi+4G';
        case '4G':
          return 'Wi-Fi+4G'; // Assume 4G tablets also have Wi-Fi
        case 'Wi-Fi+3G':
          return 'Wi-Fi+3G';
        case '3G':
          return 'Wi-Fi+3G'; // Assume 3G tablets also have Wi-Fi
        case 'Wi-Fi Only':
          return 'Wi-Fi Only';
        default:
          // If we have a connectivity type but it's not recognized, continue to fallback
          break;
      }
    }
    
    // Fallback method: Use category breadcrumb
    if (product.category && Array.isArray(product.category) && product.category.length >= 3) {
      const category3 = product.category[3]; // e.g., "Apple Tablets", "Samsung Tablets", etc.
      
      // Check if category indicates cellular capability
      if (category3 && category3.toLowerCase().includes('with call facility')) {
        return 'Wi-Fi+Cellular';
      }
      
      // Check if category indicates Wi-Fi only
      if (category3 && category3.toLowerCase().includes('without call facility')) {
        return 'Wi-Fi Only';
      }
    }
    
    // Default fallback - assume Wi-Fi Only for tablets without clear indication
    return 'Wi-Fi Only';
  }

  /**
   * Normalize price data
   */
  normalizePrice(price) {
    if (!price) {
      return {
        current: null,
        original: null,
        discount_percent: null,
        currency: "INR"
      };
    }

    const normalized = {
      current: price.current || null,
      original: price.original || null,
      discount_percent: null,
      currency: "INR"
    };

    // Extract discount percentage
    if (price.discount) {
      const discountMatch = price.discount.match(/(\d+)%\s*off/i);
      if (discountMatch) {
        normalized.discount_percent = parseInt(discountMatch[1]);
      }
    }

    return normalized;
  }

  /**
   * Normalize rating data
   */
  normalizeRating(rating) {
    if (!rating) {
      return {
        score: null,
        count: null
      };
    }

    return {
      score: rating.score || null,
      count: rating.count || null
    };
  }

  /**
   * Process Flipkart image URL
   */
  processFlipkartImage(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;
    
    // Change size from 128/128, 416/416, etc. to 845/845
    const processedUrl = imageUrl.replace(/\/\d+\/\d+\//, '/845/845/');
    
    return processedUrl;
  }

  /**
   * Process Flipkart images array
   */
  processFlipkartImages(images, mainImage) {
    if (!Array.isArray(images) || images.length === 0) return [];
    
    const processedImages = [];
    const seenUrls = new Set();
    
    // Add main image to seen URLs if provided
    if (mainImage) {
      const processedMainImage = this.processFlipkartImage(mainImage);
      if (processedMainImage) {
        seenUrls.add(processedMainImage);
      }
    }
    
    for (const imageUrl of images) {
      if (!imageUrl || typeof imageUrl !== 'string') continue;
      
      // Change size from 128/128 to 845/845
      const processedUrl = imageUrl.replace(/\/\d+\/\d+\//, '/845/845/');
      
      // Only add if we haven't seen this URL before (including main image)
      if (!seenUrls.has(processedUrl)) {
        seenUrls.add(processedUrl);
        processedImages.push(processedUrl);
      }
    }
    
    return processedImages;
  }

  /**
   * Extract display specifications
   */
  extractDisplaySpecs(specs) {
    const display = {};
    
    // Screen size
    if (specs['Product Details']?.['Display Size']) {
      display.size = specs['Product Details']['Display Size'];
    } else if (specs['Display And Audio Features']?.['Screen Size']) {
      display.size = specs['Display And Audio Features']['Screen Size'];
    }
    
    // Resolution
    if (specs['Product Details']?.['Display Resolution']) {
      display.resolution = specs['Product Details']['Display Resolution'];
    } else if (specs['Display And Audio Features']?.['Screen Resolution']) {
      display.resolution = specs['Display And Audio Features']['Screen Resolution'];
    }
    
    // Display type
    if (specs['Display Features']?.['Display Type']) {
      display.type = specs['Display Features']['Display Type'];
    } else if (specs['Display And Audio Features']?.['Screen Type']) {
      display.type = specs['Display And Audio Features']['Screen Type'];
    }
    
    // Other display features
    if (specs['Display Features']?.['Other Display Features']) {
      display.other_features = specs['Display Features']['Other Display Features'];
    }
    
    // Display PPI
    if (specs['Display Features']?.['Display PPI']) {
      display.ppi = specs['Display Features']['Display PPI'];
    }
    
    // Display aspect ratio
    if (specs['Display Features']?.['Display Aspect Ratio']) {
      display.aspect_ratio = specs['Display Features']['Display Aspect Ratio'];
    }
    
    return Object.keys(display).length > 0 ? display : null;
  }

  /**
   * Extract performance specifications
   */
  extractPerformanceSpecs(specs) {
    const performance = {};
    
    // Processor
    if (specs['General']?.['Processor Type']) {
      performance.processor = specs['General']['Processor Type'];
    } else if (specs['Processor And Memory Features']?.['Processor Name']) {
      performance.processor = specs['Processor And Memory Features']['Processor Name'];
    }
    
    // Processor speed
    if (specs['Product Details']?.['Processor Speed']) {
      performance.processor_speed = specs['Product Details']['Processor Speed'];
    }
    
    // Secondary clock speed
    if (specs['Product Details']?.['Secondary Clock Speed']) {
      performance.secondary_clock_speed = specs['Product Details']['Secondary Clock Speed'];
    }
    
    // Operating System
    if (specs['General']?.['OS']) {
      performance.os = specs['General']['OS'];
    } else if (specs['Operating System']?.['Operating System']) {
      performance.os = specs['Operating System']['Operating System'];
    }
    
    return Object.keys(performance).length > 0 ? performance : null;
  }

  /**
   * Extract camera specifications
   */
  extractCameraSpecs(specs) {
    const camera = {};
    
    // Primary camera
    if (specs['Product Details']?.['Primary Camera']) {
      camera.primary = specs['Product Details']['Primary Camera'];
    }
    
    // Secondary camera
    if (specs['Camera Features']?.['Secondary Camera']) {
      camera.secondary = specs['Camera Features']['Secondary Camera'];
    }
    
    // Video recording
    if (specs['Camera Features']?.['Video Recording']) {
      camera.video_recording = specs['Camera Features']['Video Recording'];
    }
    
    // Video recording resolution
    if (specs['Camera Features']?.['Video Recording Resolution']) {
      camera.video_recording_resolution = specs['Camera Features']['Video Recording Resolution'];
    }
    
    // Flash
    if (specs['Camera Features']?.['Flash']) {
      camera.flash = specs['Camera Features']['Flash'];
    }
    
    // Full HD recording
    if (specs['Camera Features']?.['Full HD Recording']) {
      camera.full_hd_recording = specs['Camera Features']['Full HD Recording'];
    }
    
    // HD recording
    if (specs['Camera Features']?.['HD Recording']) {
      camera.hd_recording = specs['Camera Features']['HD Recording'];
    }
    
    // Frame rate
    if (specs['Camera Features']?.['Frame Rate']) {
      camera.frame_rate = specs['Camera Features']['Frame Rate'];
    }
    
    // Other camera features
    if (specs['Camera Features']?.['Other Camera Features']) {
      camera.other_features = specs['Camera Features']['Other Camera Features'];
    }
    
    // Digital zoom
    if (specs['Camera Features']?.['Digital Zoom']) {
      camera.digital_zoom = specs['Camera Features']['Digital Zoom'];
    }
    
    return Object.keys(camera).length > 0 ? camera : null;
  }

  /**
   * Extract battery specifications
   */
  extractBatterySpecs(specs) {
    const battery = {};
    
    // Battery capacity
    if (specs['Battery Features']?.['Battery Capacity']) {
      battery.capacity = specs['Battery Features']['Battery Capacity'];
    } else if (specs['Battery Features']?.['Battery Type']) {
      battery.type = specs['Battery Features']['Battery Type'];
    }
    
    return Object.keys(battery).length > 0 ? battery : null;
  }

  /**
   * Extract connectivity specifications
   */
  extractConnectivitySpecs(specs) {
    const connectivity = {};
    
    // Connectivity type
    if (specs['General']?.['Connectivity']) {
      connectivity.type = specs['General']['Connectivity'];
    }
    
    // Bluetooth
    if (specs['Connectivity Features']?.['Bluetooth Version']) {
      connectivity.bluetooth = specs['Connectivity Features']['Bluetooth Version'];
    } else if (specs['Connectivity Features']?.['Bluetooth']) {
      connectivity.bluetooth = specs['Connectivity Features']['Bluetooth'];
    }
    
    // Bluetooth profiles
    if (specs['Connectivity Features']?.['Bluetooth Profiles']) {
      connectivity.bluetooth_profiles = specs['Connectivity Features']['Bluetooth Profiles'];
    }
    
    // WiFi
    if (specs['Connectivity Features']?.['Wi-fi Version']) {
      connectivity.wifi = specs['Connectivity Features']['Wi-fi Version'];
    }
    
    // USB
    if (specs['Connectivity Features']?.['USB']) {
      connectivity.usb = specs['Connectivity Features']['USB'];
    }
    
    // 3G
    if (specs['Connectivity Features']?.['3G']) {
      connectivity.g3 = specs['Connectivity Features']['3G'];
    }
    
    // Microphone jack
    if (specs['Connectivity Features']?.['Microphone Jack']) {
      connectivity.microphone_jack = specs['Connectivity Features']['Microphone Jack'];
    }
    
    return Object.keys(connectivity).length > 0 ? connectivity : null;
  }

  /**
   * Extract design specifications
   */
  extractDesignSpecs(specs) {
    const design = {};
    
    // Color (from General section)
    if (specs['General']?.['Color']) {
      design.color = specs['General']['Color'];
    }
    
    // Weight (check multiple possible locations)
    if (specs['Dimensions']?.['Weight']) {
      design.weight = specs['Dimensions']['Weight'];
    } else if (specs['General']?.['Weight']) {
      design.weight = specs['General']['Weight'];
    } else if (specs['Product Details']?.['Weight']) {
      design.weight = specs['Product Details']['Weight'];
    }
    
    // Dimensions (check multiple possible locations)
    if (specs['Dimensions']?.['Dimensions']) {
      design.dimensions = specs['Dimensions']['Dimensions'];
    } else if (specs['General']?.['Dimensions']) {
      design.dimensions = specs['General']['Dimensions'];
    } else if (specs['Product Details']?.['Dimensions']) {
      design.dimensions = specs['Product Details']['Dimensions'];
    }
    
    // Height, Width, Depth (check multiple possible locations)
    if (specs['Dimensions']?.['Height']) {
      design.height = specs['Dimensions']['Height'];
    } else if (specs['General']?.['Height']) {
      design.height = specs['General']['Height'];
    }
    
    if (specs['Dimensions']?.['Width']) {
      design.width = specs['Dimensions']['Width'];
    } else if (specs['General']?.['Width']) {
      design.width = specs['General']['Width'];
    }
    
    if (specs['Dimensions']?.['Depth']) {
      design.depth = specs['Dimensions']['Depth'];
    } else if (specs['General']?.['Depth']) {
      design.depth = specs['General']['Depth'];
    }
    
    // Material/Build (check multiple possible locations)
    if (specs['General']?.['Material']) {
      design.material = specs['General']['Material'];
    } else if (specs['Product Details']?.['Material']) {
      design.material = specs['Product Details']['Material'];
    }
    
    if (specs['General']?.['Build']) {
      design.build = specs['General']['Build'];
    } else if (specs['Product Details']?.['Build']) {
      design.build = specs['Product Details']['Build'];
    }
    
    return Object.keys(design).length > 0 ? design : null;
  }

  /**
   * Extract storage specifications
   */
  extractStorageSpecs(specs) {
    const storage = {};
    
    // Memory card support
    if (specs['Storage Features']?.['Memory Card Support']) {
      storage.memory_card_support = specs['Storage Features']['Memory Card Support'];
    }
    
    // Expandable storage capacity
    if (specs['Storage Features']?.['Expandable Storage Capacity']) {
      storage.expandable_capacity = specs['Storage Features']['Expandable Storage Capacity'];
    }
    
    // Memory card slot type
    if (specs['Storage Features']?.['Memory Card Slot Type']) {
      storage.card_slot_type = specs['Storage Features']['Memory Card Slot Type'];
    }
    
    // RAM type
    if (specs['Product Details']?.['RAM Type']) {
      storage.ram_type = specs['Product Details']['RAM Type'];
    }
    
    return Object.keys(storage).length > 0 ? storage : null;
  }

  /**
   * Extract multimedia specifications
   */
  extractMultimediaSpecs(specs) {
    const multimedia = {};
    
    // Video formats supported
    if (specs['Multimedia Features']?.['Video Formats Supported']) {
      multimedia.video_formats = specs['Multimedia Features']['Video Formats Supported'];
    }
    
    // Full HD playback
    if (specs['Multimedia Features']?.['Full HD Playback']) {
      multimedia.full_hd_playback = specs['Multimedia Features']['Full HD Playback'];
    }
    
    // HD playback
    if (specs['Multimedia Features']?.['HD Playback']) {
      multimedia.hd_playback = specs['Multimedia Features']['HD Playback'];
    }
    
    // Video playback
    if (specs['Multimedia Features']?.['Video Playback']) {
      multimedia.video_playback = specs['Multimedia Features']['Video Playback'];
    }
    
    return Object.keys(multimedia).length > 0 ? multimedia : null;
  }

  /**
   * Extract navigation specifications
   */
  extractNavigationSpecs(specs) {
    const navigation = {};
    
    // GPS support
    if (specs['Navigation Features']?.['GPS Support']) {
      navigation.gps_support = specs['Navigation Features']['GPS Support'];
    }
    
    // GPS type
    if (specs['Navigation Features']?.['GPS Type']) {
      navigation.gps_type = specs['Navigation Features']['GPS Type'];
    }
    
    return Object.keys(navigation).length > 0 ? navigation : null;
  }

  /**
   * Extract sensor specifications
   */
  extractSensorSpecs(specs) {
    const sensors = {};
    
    // Sensors list
    if (specs['Product Details']?.['Sensors']) {
      sensors.list = specs['Product Details']['Sensors'];
    }
    
    return Object.keys(sensors).length > 0 ? sensors : null;
  }

  /**
   * Extract warranty specifications
   */
  extractWarrantySpecs(specs) {
    const warranty = {};
    
    // Warranty period
    if (specs['Warranty']?.['Warranty']) {
      warranty.period = specs['Warranty']['Warranty'];
    }
    
    // Warranty summary
    if (specs['Warranty']?.['Warranty Summary']) {
      warranty.summary = specs['Warranty']['Warranty Summary'];
    }
    
    // Warranty service type
    if (specs['Warranty']?.['Warranty Service Type']) {
      warranty.service_type = specs['Warranty']['Warranty Service Type'];
    }
    
    // Domestic warranty
    if (specs['Warranty']?.['Domestic Warranty']) {
      warranty.domestic = specs['Warranty']['Domestic Warranty'];
    }
    
    // Covered in warranty
    if (specs['Warranty']?.['Covered in Warranty']) {
      warranty.covered = specs['Warranty']['Covered in Warranty'];
    }
    
    // Not covered in warranty
    if (specs['Warranty']?.['Not Covered in Warranty']) {
      warranty.not_covered = specs['Warranty']['Not Covered in Warranty'];
    }
    
    return Object.keys(warranty).length > 0 ? warranty : null;
  }

  /**
   * Extract general specifications
   */
  extractGeneralSpecs(specs) {
    const general = {};
    
    // Ideal usage
    if (specs['General']?.['Ideal Usage']) {
      general.ideal_usage = specs['General']['Ideal Usage'];
    }
    
    // Voice call support
    if (specs['General']?.['Voice Call']) {
      general.voice_call = specs['General']['Voice Call'];
    }
    
    // Video call support
    if (specs['General']?.['Video Call']) {
      general.video_call = specs['General']['Video Call'];
    }
    
    // HD video call support
    if (specs['General']?.['HD Video Call']) {
      general.hd_video_call = specs['General']['HD Video Call'];
    }
    
    // Supported network
    if (specs['General']?.['Supported Network']) {
      general.supported_network = specs['General']['Supported Network'];
    }
    
    // Display resolution type
    if (specs['General']?.['Display Resolution Type']) {
      general.display_resolution_type = specs['General']['Display Resolution Type'];
    }
    
    // Operating system version
    if (specs['General']?.['Operating System Version']) {
      general.os_version = specs['General']['Operating System Version'];
    }
    
    // OS upgradable version
    if (specs['Product Details']?.['OS Upgradable Version']) {
      general.os_upgradable = specs['Product Details']['OS Upgradable Version'];
    }
    
    // Sim type
    if (specs['Product Details']?.['Sim Type']) {
      general.sim_type = specs['Product Details']['Sim Type'];
    }
    
    // Sim access
    if (specs['Product Details']?.['Sim Access']) {
      general.sim_access = specs['Product Details']['Sim Access'];
    }
    
    // Sales package
    if (specs['Product Details']?.['Sales Package']) {
      general.sales_package = specs['Product Details']['Sales Package'];
    }
    
    return Object.keys(general).length > 0 ? general : null;
  }

  /**
   * Normalize data from file
   */
  async normalizeFromFile(inputPath) {
    try {
      console.log(`Reading file: ${inputPath}`);
      const rawData = fs.readFileSync(inputPath, 'utf8');
      const products = JSON.parse(rawData);
      
      console.log(`Normalizing ${products.length} Flipkart tablet products...`);
      const normalizedData = this.normalizeProducts(products);
      console.log(`Successfully normalized ${normalizedData.length} products`);
      
      return normalizedData;
    } catch (error) {
      console.error(`Error reading/normalizing file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save normalized data to file
   */
  async saveNormalizedData(normalizedData, outputPath) {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      fs.writeFileSync(outputPath, JSON.stringify(normalizedData, null, 2));
      console.log(`Saved normalized data to ${outputPath}`);
    } catch (error) {
      console.error(`Error saving normalized data: ${error.message}`);
      throw error;
    }
  }
}

module.exports = FlipkartTabletNormalizer;

// Main execution block - run when file is executed directly
if (require.main === module) {
  async function main() {
    try {
      console.log('🚀 Starting Flipkart Tablet Normalizer...\n');
      
      // Initialize normalizer
      const normalizer = new FlipkartTabletNormalizer();
      
      // Define input and output paths
      const inputPath = path.join(__dirname, '../scrapers/flipkart/raw_data/flipkart_tablet_scraped_data.json');
      const outputPath = path.join(__dirname, '../../parsed_data/flipkart_tablet_normalized_data.json');
      
      console.log(`📁 Input file: ${inputPath}`);
      console.log(`📁 Output file: ${outputPath}\n`);
      
      // Check if input file exists
      if (!fs.existsSync(inputPath)) {
        console.error(`❌ Input file not found: ${inputPath}`);
        console.log('💡 Please run the Flipkart tablet crawler first to generate scraped data.');
        process.exit(1);
      }
      
      // Normalize the data
      const normalizedData = await normalizer.normalizeFromFile(inputPath);
      
      // Save normalized data
      await normalizer.saveNormalizedData(normalizedData, outputPath);
      
      console.log('\n✅ Flipkart tablet normalization completed successfully!');
      console.log(`📊 Normalized ${normalizedData.length} products`);
      
    } catch (error) {
      console.error('\n❌ Normalization failed:', error.message);
      process.exit(1);
    }
  }
  
  // Run the main function
  main();
}
