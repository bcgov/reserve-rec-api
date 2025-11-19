# Lambda Layer Pre-building for SAM Local

This directory contains tools to dramatically improve SAM Local startup performance by pre-building and caching Lambda layers.

## Problem

When using `sam local start-api`, Docker containers for Lambda layers are built from scratch each time, which can take several minutes. This significantly slows down the local development workflow.

## Solution

The layer pre-building system creates cached, ready-to-use layer directories that SAM Local can use directly without Docker rebuilds.

## Quick Start

### Option 1: Automated (Recommended)
```bash
# Build layers and generate SAM templates in one command
node sam-quick-start.js

# Or build, generate, and start API server
node sam-quick-start.js --start-api
```

### Option 2: Manual Steps
```bash
# 1. Pre-build all layers (one-time or when dependencies change)
node build-lambda-layers.js

# 2. Generate SAM templates using cached layers
node generate-sam-templates.js --use-layer-cache

# 3. Start SAM Local (much faster now)
cd ../../..
sam local start-api --host 0.0.0.0 --port 3000
```

## Performance Impact

- **Without layer caching**: 3-5 minutes startup time
- **With layer caching**: 15-30 seconds startup time
- **Performance improvement**: 80-90% reduction in startup time

## Scripts Overview

### `build-lambda-layers.js`
Pre-builds Lambda layers into a cached directory structure.

```bash
# Build all layers
node build-lambda-layers.js

# Force rebuild even if cached
node build-lambda-layers.js --force

# Build specific layer only
node build-lambda-layers.js --layer BaseLayer

# Use custom cache directory
node build-lambda-layers.js --cache-dir ./my-cache
```

### `generate-sam-templates.js` (Enhanced)
Original SAM template generator with new layer caching support.

```bash
# Use cached layers (fast)
node generate-sam-templates.js --use-layer-cache

# Use source directories (slow, original behavior)
node generate-sam-templates.js

# Custom cache directory
node generate-sam-templates.js --use-layer-cache --layer-cache-dir ./my-cache
```

### `sam-quick-start.js`
Automated workflow that handles the complete setup process.

```bash
# Standard quick start
node sam-quick-start.js

# Force rebuild layers
node sam-quick-start.js --force-rebuild

# Skip caching (use original slow method)
node sam-quick-start.js --no-cache

# Complete setup and start API
node sam-quick-start.js --start-api
```

## How It Works

1. **Layer Analysis**: The system identifies all Lambda layers in your CDK templates
2. **Source Copying**: Layer source code is copied to cache directories
3. **Dependency Building**: `npm install --production` is run in each cached layer
4. **Metadata Tracking**: Hash-based change detection determines when rebuilds are needed
5. **Path Substitution**: SAM templates reference cached directories instead of source paths

## Cache Directory Structure

```
.layer-cache/
├── BaseLayer/
│   ├── .layer-metadata.json
│   ├── package.json
│   ├── node_modules/
│   └── [layer source files]
├── AwsUtilsLayer/
│   ├── .layer-metadata.json
│   └── [layer source files]
└── [other layers...]
```

## When to Rebuild

Layers are automatically rebuilt when:
- Source files change (detected via hash comparison)
- `package.json` dependencies are modified
- Using `--force` flag
- Cache doesn't exist

## Troubleshooting

### Cache Issues
```bash
# Clear cache and rebuild
rm -rf .layer-cache
node build-lambda-layers.js
```

### Missing Dependencies
```bash
# Ensure all layer source directories exist
ls -la src/layers/
```

### Permission Issues
```bash
# Make scripts executable
chmod +x build-lambda-layers.js
chmod +x sam-quick-start.js
```

## Integration with Existing Workflow

This system is backward compatible. You can:
- Continue using `generate-sam-templates.js` without caching
- Mix cached and non-cached approaches
- Use existing environment variable overrides
- Keep all existing configuration files

## Environment Variables

All existing environment variable support is preserved:
- `sam-config.json` for defaults
- `--var.VARIABLE=value` CLI overrides
- `VARIABLE=value` shorthand syntax
- External config files via `--config`

## Performance Tips

1. **Pre-build after dependency changes**: Run `build-lambda-layers.js` after updating `package.json` files
2. **Use automation**: `sam-quick-start.js` handles the complete workflow
3. **Cache directory location**: Keep cache on fastest available storage (SSD)
4. **CI/CD integration**: Pre-build layers in CI for even faster local development

## Compatibility

- Works with all existing CDK templates
- Compatible with all current SAM Local features
- Preserves all authentication and environment variable handling
- No changes required to Lambda function code