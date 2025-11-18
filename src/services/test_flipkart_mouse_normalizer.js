/**
 * Test script for Flipkart Mouse Normalizer
 * Tests the normalizer with sample data from Flipkart mouse scraped data
 */

const fs = require('fs');
const path = require('path');
const FlipkartMouseNormalizer = require('./flipkart_mouse_normalizer');

// Function to read and parse JSON file
function readJsonFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading JSON file: ${error.message}`);
    return null;
  }
}

// Function to test normalizer with sample data
function testNormalizer() {
  console.log('Testing Flipkart Mouse Normalizer...\n');
  
  // Read the Flipkart mouse data file
  const filePath = path.join(__dirname, '..', 'scrapers', 'flipkart', 'raw_data', 'flipkart_mouse_scraped_data.json');
  
  // Since the file might be large, let's read just a few entries
  try {
    const data = readJsonFile(filePath);
    
    if (!data || !Array.isArray(data)) {
      console.error('Could not read Flipkart mouse data or data is not an array');
      return;
    }
    
    console.log(`Found ${data.length} products in the data file.`);
    
    // Test with first 5 products
    const testProducts = data.slice(0, 5);
    
    console.log('\n=== NORMALIZATION RESULTS ===\n');
    
    testProducts.forEach((product, index) => {
      console.log(`--- Product ${index + 1} ---`);
      
      // Normalize the product
      const normalized = FlipkartMouseNormalizer.normalize(product);
      
      // Display results
      console.log(`Title: ${normalized.title}`);
      console.log(`Brand: ${normalized.brand}`);
      console.log(`Model Name: ${normalized.modelName || 'Not found'}`);
      console.log(`Model Number: ${normalized.modelNumber || 'Not found'}`);
      console.log(`Price: ₹${normalized.price || 'N/A'}`);
      console.log(`Rating: ${normalized.rating || 'N/A'} (${normalized.ratingCount || 0} reviews)`);
      console.log(`Availability: ${normalized.availability}`);
      console.log('');
    });
    
    // Test specific edge cases
    console.log('\n=== EDGE CASE TESTING ===\n');
    
    // Test with a product that has no specifications
    const productWithoutSpecs = {
      url: 'https://www.example.com/test-mouse',
      title: 'Test Brand SuperMouse XYZ-123 Wireless Gaming Mouse',
      price: { current: 1999, original: 2999, discount: '33% off' },
      rating: { score: 4.2, count: 150 },
      availability: 'In Stock',
      specifications: {},
      category: ['Home', 'Computers', 'Test Brand Mouse'],
      image: 'https://example.com/test-mouse.jpg',
      images: []
    };
    
    console.log('--- Testing product without specifications ---');
    const normalizedNoSpecs = FlipkartMouseNormalizer.normalize(productWithoutSpecs);
    console.log(`Title: ${normalizedNoSpecs.title}`);
    console.log(`Brand: ${normalizedNoSpecs.brand}`);
    console.log(`Model Name: ${normalizedNoSpecs.modelName || 'Not found'}`);
    console.log(`Model Number: ${normalizedNoSpecs.modelNumber || 'Not found'}`);
    console.log('');
    
    // Test with a product that has specifications but no model info
    const productWithSpecsNoModel = {
      url: 'https://www.example.com/test-mouse2',
      title: 'Logitech MX Master 3S Advanced Wireless Mouse',
      price: { current: 8999, original: 9999, discount: '10% off' },
      rating: { score: 4.8, count: 2500 },
      availability: 'In Stock',
      specifications: {
        'General': {
          'Color': 'Graphite',
          'Form Factor': 'Ambidextrous'
        },
        'Connectivity': {
          'Bluetooth': 'Yes',
          'USB': '2.4GHz Wireless'
        }
      },
      category: ['Home', 'Computers', 'Computer Peripherals', 'Logitech Mouse'],
      image: 'https://example.com/test-mouse2.jpg',
      images: []
    };
    
    console.log('--- Testing product with specifications but no model info ---');
    const normalizedSpecsNoModel = FlipkartMouseNormalizer.normalize(productWithSpecsNoModel);
    console.log(`Title: ${normalizedSpecsNoModel.title}`);
    console.log(`Brand: ${normalizedSpecsNoModel.brand}`);
    console.log(`Model Name: ${normalizedSpecsNoModel.modelName || 'Not found'}`);
    console.log(`Model Number: ${normalizedSpecsNoModel.modelNumber || 'Not found'}`);
    console.log('');
    
  } catch (error) {
    console.error(`Error testing normalizer: ${error.message}`);
    
    // If we can't read the file, let's create a mock test
    console.log('\n=== MOCK DATA TESTING ===\n');
    
    // Mock product data based on what we observed
    const mockProducts = [
      {
        url: 'https://www.flipkart.com/razer-basilisk-v3-pro-customizable-mouse-hyperscroll-tilt-wheel-rz01-04620200-r3a1-wireless-ambidextrous-optical-gaming-bluetooth/p/itmfc1995a9d6cb2?pid=ACCGPTFXUAGAZUXY',
        title: 'Razer Basilisk V3 Pro Customizable mouse HyperScroll Tilt Wheel -RZ01-04620200-R3A1 Wireless Ambidextrous Optical  Gaming Mouse  with BluetoothAA(White)',
        price: { current: 18399, original: 27999, discount: '34% off' },
        rating: { score: 3.8, count: 5 },
        availability: 'In Stock',
        specifications: {
          'General': {
            'Model Name': 'Basilisk V3 Pro Customizable mouse HyperScroll Tilt Wheel -RZ01-04620200-R3A1',
            'System Requirements': 'All in one PCs',
            'Form Factor': 'Ambidextrous',
            'Sales Package': 'Gaming Mouse',
            'Resolution': '30000 Dpi',
            'Compatible Devices': 'Desktop Computer, Laptop',
            'Color': 'White'
          },
          'Connectivity And Power Features': {
            'Bluetooth': 'Yes'
          }
        },
        category: [
          'Home', 'Computers', 'Computer Peripherals', 'Keyboards, Mouse & Accessories', 'Mouse',
          'Razer Mouse', 'Razer Basilisk V3 Pro Customizable mouse HyperScroll Tilt Wheel -RZ01-04620200-R3A1 Wireless Ambidextrous Optical  Gaming Mouse  with Bluetooth (White)'
        ],
        image: 'https://example.com/razer-mouse.jpg',
        images: []
      },
      {
        url: 'https://www.flipkart.com/logitech-mx-master-3s-wireless-ambidextrous-touch-mouse-bluetooth/p/itm271ade01ff274?pid=ACCGFPFCAFGREFHZ',
        title: 'Logitech MX Master 3s Wireless Ambidextrous Touch Mouse  with BluetoothA(2.4GHz Wireless, Bluetooth, Graphite)',
        price: { current: 9495, original: 10995, discount: '13% off' },
        rating: { score: 4.6, count: 2024 },
        availability: 'In Stock',
        specifications: {
          'General': {
            'Model Name': 'MX Master 3s',
            'System Requirements': 'Bluetooth: Windows 8, Unifying Receiver: Windows 10, Windows 8, Windows 7, Unifying Receiver USB Port',
            'Form Factor': 'Ambidextrous',
            'Sales Package': 'Mouse, Logi Bolt USB receiver, USB-C charging cable (USB-A to USB-C), User documentation',
            'Controls': 'Scroll Wheel, Right Click, Left Click, Wheel Click, App-switch, Thumb Wheel, Gesture Button',
            'Color': 'Graphite'
          },
          'Connectivity And Power Features': {
            'USB Type': 'USB 3.0',
            'Surface Tracking': 'Yes',
            'Bluetooth': 'Yes'
          }
        },
        category: [
          'Home', 'Computers', 'Computer Peripherals', 'Keyboards, Mouse & Accessories', 'Mouse',
          'Logitech Mouse', 'Logitech MX Master 3s Wireless Ambidextrous Touch Mouse  with Bluetooth (2.4GHz Wireless, Bluetooth, Graphite)'
        ],
        image: 'https://example.com/logitech-mouse.jpg',
        images: []
      },
      {
        url: 'https://www.flipkart.com/apple-magic-mouse-mmmq3hn-a-wireless-touch-bluetooth/p/itm75e126a59705b?pid=ACCGCAYHQFG4GKHH',
        title: 'Apple Magic Mouse MMMQ3HN/A Wireless Touch Mouse  with BluetoothAA(Black)',
        price: { current: 8999, original: 9500, discount: '5% off' },
        rating: { score: 4.6, count: 363 },
        availability: 'In Stock',
        specifications: {
          'General': {
            'Model Name': 'MMMQ3HN/A',
            'System Requirements': 'Bluetooth-enabled Mac with OS X 10.11 or Later and iPad with iPad OS 13.4 or Later',
            'Form Factor': 'Ambidextrous',
            'Sales Package': 'WIRELESS MOUSE 1N, LIGHTNING TO USB CABLE 1N',
            'Color': 'Black',
            'Part Number': 'MMMQ3ZM/A'
          }
        },
        category: [
          'Home', 'Computers', 'Computer Peripherals', 'Keyboards, Mouse & Accessories', 'Mouse',
          'Apple Mouse', 'Apple Magic Mouse MMMQ3HN/A Wireless Touch Mouse  with Bluetooth (Black)'
        ],
        image: 'https://example.com/apple-mouse.jpg',
        images: []
      }
    ];
    
    console.log('Testing with mock data:\n');
    
    mockProducts.forEach((product, index) => {
      console.log(`--- Mock Product ${index + 1} ---`);
      
      // Normalize the product
      const normalized = FlipkartMouseNormalizer.normalize(product);
      
      // Display results
      console.log(`Title: ${normalized.title}`);
      console.log(`Brand: ${normalized.brand}`);
      console.log(`Model Name: ${normalized.modelName || 'Not found'}`);
      console.log(`Model Number: ${normalized.modelNumber || 'Not found'}`);
      console.log(`Price: ₹${normalized.price || 'N/A'}`);
      console.log(`Rating: ${normalized.rating || 'N/A'} (${normalized.ratingCount || 0} reviews)`);
      console.log(`Availability: ${normalized.availability}`);
      console.log('');
    });
  }
}

// Run the test
testNormalizer();