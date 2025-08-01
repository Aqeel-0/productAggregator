#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Test runner script with different test suites
class TestRunner {
  constructor() {
    this.baseCommand = 'npx';
    this.jestPath = 'jest';
    this.projectRoot = path.resolve(__dirname, '..');
  }

  async runCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      console.log(`🚀 Running: ${command} ${args.join(' ')}`);
      
      // On Windows, we need to use 'cmd' and '/c' to run npx properly
      const isWindows = process.platform === 'win32';
      const finalCommand = isWindows ? 'cmd' : command;
      const finalArgs = isWindows ? ['/c', command, ...args] : args;
      
      const child = spawn(finalCommand, finalArgs, {
        stdio: 'inherit',
        cwd: this.projectRoot,
        shell: isWindows,
        ...options
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(code);
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  async runUnitTests() {
    console.log('\n📋 Running Unit Tests...');
    console.log('=' .repeat(50));
    
    try {
      await this.runCommand(this.baseCommand, [
        this.jestPath,
        '--testPathPattern=tests/unit',
        '--coverage',
        '--verbose',
        '--detectOpenHandles',
        '--forceExit'
      ]);
      
      console.log('✅ Unit tests completed successfully!');
    } catch (error) {
      console.error('❌ Unit tests failed:', error.message);
      throw error;
    }
  }

  async runIntegrationTests() {
    console.log('\n🔗 Running Integration Tests...');
    console.log('=' .repeat(50));
    
    try {
      await this.runCommand(this.baseCommand, [
        this.jestPath,
        '--testPathPattern=tests/integration',
        '--verbose',
        '--detectOpenHandles',
        '--forceExit',
        '--runInBand' // Run integration tests serially
      ]);
      
      console.log('✅ Integration tests completed successfully!');
    } catch (error) {
      console.error('❌ Integration tests failed:', error.message);
      throw error;
    }
  }

  async runPerformanceTests() {
    console.log('\n⚡ Running Performance Tests...');
    console.log('=' .repeat(50));
    
    try {
      await this.runCommand(this.baseCommand, [
        this.jestPath,
        '--testPathPattern=tests/performance',
        '--verbose',
        '--detectOpenHandles',
        '--forceExit',
        '--runInBand', // Run performance tests serially
        '--testTimeout=300000' // 5 minute timeout
      ], {
        env: {
          ...process.env,
          RUN_PERFORMANCE_TESTS: 'true'
        }
      });
      
      console.log('✅ Performance tests completed successfully!');
    } catch (error) {
      console.error('❌ Performance tests failed:', error.message);
      throw error;
    }
  }

  async runAllTests() {
    console.log('\n🧪 Running All Tests...');
    console.log('=' .repeat(50));
    
    try {
      await this.runCommand(this.baseCommand, [
        this.jestPath,
        '--coverage',
        '--verbose',
        '--detectOpenHandles',
        '--forceExit'
      ]);
      
      console.log('✅ All tests completed successfully!');
    } catch (error) {
      console.error('❌ Some tests failed:', error.message);
      throw error;
    }
  }

  async runCoverageReport() {
    console.log('\n📊 Generating Coverage Report...');
    console.log('=' .repeat(50));
    
    try {
      await this.runCommand(this.baseCommand, [
        this.jestPath,
        '--coverage',
        '--coverageReporters=html',
        '--coverageReporters=text-summary',
        '--passWithNoTests'
      ]);
      
      console.log('✅ Coverage report generated!');
      console.log('📁 Open coverage/html/index.html to view detailed report');
    } catch (error) {
      console.error('❌ Coverage report generation failed:', error.message);
      throw error;
    }
  }

  async runWatch() {
    console.log('\n👀 Running Tests in Watch Mode...');
    console.log('=' .repeat(50));
    
    try {
      await this.runCommand(this.baseCommand, [
        this.jestPath,
        '--watch',
        '--testPathPattern=tests/unit',
        '--verbose'
      ]);
    } catch (error) {
      console.error('❌ Watch mode failed:', error.message);
      throw error;
    }
  }

  async runLint() {
    console.log('\n🔍 Running Linter...');
    console.log('=' .repeat(50));
    
    try {
      await this.runCommand('npx', ['eslint', 'src/**/*.js', 'tests/**/*.js', '--fix']);
      console.log('✅ Linting completed successfully!');
    } catch (error) {
      console.error('❌ Linting failed:', error.message);
      throw error;
    }
  }

  printUsage() {
    console.log('\n🧪 Test Runner Usage:');
    console.log('=' .repeat(50));
    console.log('node scripts/run-tests.js [command]');
    console.log('');
    console.log('Commands:');
    console.log('  unit         Run unit tests only');
    console.log('  integration  Run integration tests only');
    console.log('  performance  Run performance tests only');
    console.log('  all          Run all tests (default)');
    console.log('  coverage     Generate coverage report');
    console.log('  watch        Run tests in watch mode');
    console.log('  lint         Run linter');
    console.log('  help         Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/run-tests.js unit');
    console.log('  node scripts/run-tests.js performance');
    console.log('  node scripts/run-tests.js coverage');
    console.log('');
  }

  async run() {
    const command = process.argv[2] || 'all';
    
    try {
      switch (command) {
        case 'unit':
          await this.runUnitTests();
          break;
        case 'integration':
          await this.runIntegrationTests();
          break;
        case 'performance':
          await this.runPerformanceTests();
          break;
        case 'all':
          await this.runAllTests();
          break;
        case 'coverage':
          await this.runCoverageReport();
          break;
        case 'watch':
          await this.runWatch();
          break;
        case 'lint':
          await this.runLint();
          break;
        case 'help':
        case '--help':
        case '-h':
          this.printUsage();
          break;
        default:
          console.error(`❌ Unknown command: ${command}`);
          this.printUsage();
          process.exit(1);
      }
    } catch (error) {
      console.error('\n💥 Test run failed:', error.message);
      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const runner = new TestRunner();
  runner.run();
}

module.exports = TestRunner;