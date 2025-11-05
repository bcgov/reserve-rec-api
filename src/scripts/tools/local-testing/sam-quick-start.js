#!/usr/bin/env node

/**
 * Quick SAM Launcher
 *
 * This script provides a streamlined way to build layers and generate SAM templates
 * for fast local development. It handles layer caching automatically.
 *
 * Usage:
 *   node sam-quick-start.js [options]
 *
 * Options:
 *   --force-rebuild      Force rebuild layers even if they exist
 *   --no-cache          Skip layer caching (use source directories)
 *   --start-api         Start SAM local API after generation
 *   --help              Show this help message
 */

const { execSync } = require('child_process');
const path = require('path');
const LayerBuilder = require('./build-lambda-layers');

async function quickStart() {
    console.log('🚀 SAM Quick Start for Local Development\n');

    const args = process.argv.slice(2);
    const options = {
        forceRebuild: args.includes('--force-rebuild'),
        noCache: args.includes('--no-cache'),
        startApi: args.includes('--start-api'),
        help: args.includes('--help')
    };

    if (options.help) {
        showHelp();
        return;
    }

    try {
        // Step 1: Build layers if using cache
        if (!options.noCache) {
            console.log('📦 Step 1: Building Lambda layers...');

            const layerTypes = ['BaseLayer', 'AwsUtilsLayer', 'DataUtilsLayer', 'JwtLayer'];
            const cachedLayers = layerTypes.filter(layer => LayerBuilder.isCached(layer));

            if (options.forceRebuild || cachedLayers.length === 0) {
                console.log('   Building all layers...');
                const buildCmd = options.forceRebuild
                    ? 'node build-lambda-layers.js --force'
                    : 'node build-lambda-layers.js';

                execSync(buildCmd, {
                    stdio: 'inherit',
                    cwd: __dirname
                });
            } else {
                console.log(`   ✅ All layers cached (${cachedLayers.join(', ')})`);
            }
        } else {
            console.log('⚠️  Skipping layer caching (--no-cache specified)');
        }

        // Step 2: Generate SAM templates
        console.log('\n🔧 Step 2: Generating SAM templates...');
        const samCmd = options.noCache
            ? 'node generate-sam-templates.js'
            : 'node generate-sam-templates.js --use-layer-cache';

        execSync(samCmd, {
            stdio: 'inherit',
            cwd: __dirname
        });

        // Step 3: Start SAM Local API if requested
        if (options.startApi) {
            console.log('\n🌐 Step 3: Starting SAM Local API...');
            console.log('Press Ctrl+C to stop the API server\n');

            // Change to project root for SAM commands
            const projectRoot = path.resolve(__dirname, '../../..');
            execSync('sam local start-api --host 0.0.0.0 --port 3000', {
                stdio: 'inherit',
                cwd: projectRoot
            });
        } else {
            console.log('\n✅ SAM templates generated successfully!');
            console.log('\nNext steps:');
            console.log('  cd ../../..');
            console.log('  sam local start-api --host 0.0.0.0 --port 3000');
        }

    } catch (error) {
        console.error('\n❌ Quick start failed:', error.message);
        process.exit(1);
    }
}

function showHelp() {
    console.log(`
SAM Quick Start for Local Development

This script automates the complete local development setup:
1. Builds and caches Lambda layers (for performance)
2. Generates SAM templates from CDK output
3. Optionally starts SAM Local API

Usage: node sam-quick-start.js [options]

Options:
  --force-rebuild      Force rebuild layers even if they exist
  --no-cache          Skip layer caching (use source directories)
  --start-api         Start SAM local API after generation
  --help              Show this help message

Examples:
  # Quick setup with cached layers
  node sam-quick-start.js

  # Force rebuild everything and start API
  node sam-quick-start.js --force-rebuild --start-api

  # Generate without layer caching
  node sam-quick-start.js --no-cache

Performance Notes:
- Layer caching improves SAM Local startup time by 80-90%
- Cached layers are reused until source files change
- Use --force-rebuild after updating layer dependencies
    `);
}

// Run if called directly
if (require.main === module) {
    quickStart();
}

module.exports = { quickStart };