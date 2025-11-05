#!/usr/bin/env node

/**
 * Lambda Layer Pre-builder
 *
 * This script pre-builds Lambda layers into a cached directory structure
 * that can be reused by SAM Local without triggering Docker rebuilds.
 *
 * Usage:
 *   node build-lambda-layers.js [options]
 *
 * Options:
 *   --cache-dir <path>    Directory to store built layers (default: ./.layer-cache)
 *   --force              Force rebuild even if layers exist
 *   --layer <name>       Build specific layer only (BaseLayer, AwsUtilsLayer, etc.)
 *   --help               Show this help message
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class LayerBuilder {
    constructor(options = {}) {
        this.projectRoot = path.resolve(__dirname, '../../../..');
        this.cacheDir = options.cacheDir || path.join(this.projectRoot, '.layer-cache');
        this.force = options.force || false;
        this.specificLayer = options.layer || null;

        this.layerDefinitions = {
            'BaseLayer': {
                sourcePath: 'src/layers/base',
                dependencies: ['nodejs/package.json'],
                buildCommand: 'cd nodejs && npm install --production'
            },
            'AwsUtilsLayer': {
                sourcePath: 'src/layers/awsUtils',
                dependencies: ['nodejs/package.json'],
                buildCommand: 'cd nodejs && npm install --production'
            },
            'DataUtilsLayer': {
                sourcePath: 'src/layers/dataUtils',
                dependencies: ['nodejs/package.json'],
                buildCommand: 'cd nodejs && npm install --production'
            },
            'JwtLayer': {
                sourcePath: 'src/layers/jwt',
                dependencies: ['nodejs/package.json'],
                buildCommand: 'cd nodejs && npm install --production'
            }
        };
    }

    /**
     * Main entry point
     */
    async build() {
        console.log('🚀 Lambda Layer Pre-builder');
        console.log(`📁 Cache directory: ${this.cacheDir}`);
        console.log(`🔨 Project root: ${this.projectRoot}`);

        // Ensure cache directory exists
        this.ensureCacheDirectory();

        const layersToBuild = this.specificLayer
            ? [this.specificLayer]
            : Object.keys(this.layerDefinitions);

        console.log(`📦 Building layers: ${layersToBuild.join(', ')}`);

        for (const layerName of layersToBuild) {
            await this.buildLayer(layerName);
        }

        console.log('✅ All layers built successfully!');
        console.log(`💡 To use cached layers, run: node generate-sam-templates.js --use-layer-cache`);
    }

    /**
     * Ensure cache directory structure exists
     */
    ensureCacheDirectory() {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            console.log(`📁 Created cache directory: ${this.cacheDir}`);
        }
    }

    /**
     * Build a specific layer
     */
    async buildLayer(layerName) {
        const layerDef = this.layerDefinitions[layerName];
        if (!layerDef) {
            console.error(`❌ Unknown layer: ${layerName}`);
            return;
        }

        console.log(`\n🔨 Building ${layerName}...`);

        const sourcePath = path.join(this.projectRoot, layerDef.sourcePath);
        const cachePath = path.join(this.cacheDir, layerName);

        // Check if source exists
        if (!fs.existsSync(sourcePath)) {
            console.warn(`⚠️  Source path does not exist: ${sourcePath}`);
            return;
        }

        // Check if rebuild is needed
        if (!this.force && this.isCacheValid(layerName, sourcePath, cachePath)) {
            console.log(`✓ ${layerName} is up to date`);
            return;
        }

        // Clean and create cache directory
        if (fs.existsSync(cachePath)) {
            fs.rmSync(cachePath, { recursive: true, force: true });
        }
        fs.mkdirSync(cachePath, { recursive: true });

        // Copy source files to cache
        this.copyLayerFiles(sourcePath, cachePath);

        // Build layer if needed
        if (layerDef.buildCommand) {
            console.log(`   📦 Running build command: ${layerDef.buildCommand}`);
            try {
                execSync(layerDef.buildCommand, {
                    cwd: cachePath,
                    stdio: 'inherit'
                });
                console.log(`   ✅ Build completed for ${layerName}`);
            } catch (error) {
                console.error(`   ❌ Build failed for ${layerName}:`, error.message);
                throw error;
            }
        }

        // Create metadata file
        this.createLayerMetadata(layerName, cachePath, sourcePath);

        console.log(`✅ ${layerName} built successfully`);
    }

    /**
     * Check if cached layer is valid (newer than source)
     */
    isCacheValid(layerName, sourcePath, cachePath) {
        const metadataPath = path.join(cachePath, '.layer-metadata.json');

        if (!fs.existsSync(metadataPath)) {
            return false;
        }

        try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            const sourceStats = this.getDirectoryStats(sourcePath);

            return metadata.sourceHash === sourceStats.hash;
        } catch (error) {
            console.warn(`   ⚠️  Could not validate cache for ${layerName}:`, error.message);
            return false;
        }
    }

    /**
     * Copy layer files from source to cache
     */
    copyLayerFiles(sourcePath, cachePath) {
        console.log(`   📋 Copying files from ${sourcePath} to ${cachePath}`);

        // Use recursive copy
        this.copyDirectory(sourcePath, cachePath);
    }

    /**
     * Recursively copy directory
     */
    copyDirectory(src, dest) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        const items = fs.readdirSync(src);

        for (const item of items) {
            const srcPath = path.join(src, item);
            const destPath = path.join(dest, item);

            if (fs.statSync(srcPath).isDirectory()) {
                this.copyDirectory(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    /**
     * Create metadata file for the built layer
     */
    createLayerMetadata(layerName, cachePath, sourcePath) {
        const sourceStats = this.getDirectoryStats(sourcePath);

        const metadata = {
            layerName: layerName,
            buildTime: new Date().toISOString(),
            sourceHash: sourceStats.hash,
            sourceModified: sourceStats.modified,
            cachePath: cachePath
        };

        const metadataPath = path.join(cachePath, '.layer-metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        console.log(`   📄 Metadata written to ${metadataPath}`);
    }

    /**
     * Get directory statistics for change detection
     */
    getDirectoryStats(dirPath) {
        const crypto = require('crypto');
        const hash = crypto.createHash('md5');
        let latestModified = 0;

        const processDirectory = (dir) => {
            const items = fs.readdirSync(dir);

            for (const item of items) {
                const itemPath = path.join(dir, item);
                const stats = fs.statSync(itemPath);

                if (stats.isDirectory()) {
                    processDirectory(itemPath);
                } else {
                    // Hash file path and modification time
                    hash.update(itemPath + stats.mtime.getTime().toString());
                    latestModified = Math.max(latestModified, stats.mtime.getTime());
                }
            }
        };

        processDirectory(dirPath);

        return {
            hash: hash.digest('hex'),
            modified: new Date(latestModified).toISOString()
        };
    }

    /**
     * Get cache path for a specific layer
     */
    static getCachePathForLayer(layerName, cacheDir = null) {
        const projectRoot = path.resolve(__dirname, '../../../..');
        const defaultCacheDir = path.join(projectRoot, '.layer-cache');
        const actualCacheDir = cacheDir || defaultCacheDir;

        return path.join(actualCacheDir, layerName);
    }

    /**
     * Check if cached layer exists
     */
    static isCached(layerName, cacheDir = null) {
        const cachePath = LayerBuilder.getCachePathForLayer(layerName, cacheDir);
        const metadataPath = path.join(cachePath, '.layer-metadata.json');

        return fs.existsSync(cachePath) && fs.existsSync(metadataPath);
    }
}

// CLI handling
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
            case '--cache-dir':
                options.cacheDir = args[++i];
                break;
            case '--force':
                options.force = true;
                break;
            case '--layer':
                options.layer = args[++i];
                break;
            case '--help':
                console.log(`
Lambda Layer Pre-builder

Usage: node build-lambda-layers.js [options]

Options:
  --cache-dir <path>    Directory to store built layers (default: ./.layer-cache)
  --force              Force rebuild even if layers exist
  --layer <name>       Build specific layer only (BaseLayer, AwsUtilsLayer, etc.)
  --help               Show this help message

Examples:
  node build-lambda-layers.js                    # Build all layers
  node build-lambda-layers.js --force            # Force rebuild all layers
  node build-lambda-layers.js --layer BaseLayer  # Build only BaseLayer
                `);
                process.exit(0);
            default:
                if (arg.startsWith('--')) {
                    console.error(`Unknown option: ${arg}`);
                    process.exit(1);
                }
        }
    }

    const builder = new LayerBuilder(options);
    builder.build().catch(error => {
        console.error('❌ Build failed:', error);
        process.exit(1);
    });
}

module.exports = LayerBuilder;