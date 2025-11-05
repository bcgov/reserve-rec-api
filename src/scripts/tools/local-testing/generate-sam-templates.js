#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const LayerBuilder = require('./build-lambda-layers');

class SAMTemplateGenerator {
    constructor(cdkOutDir, options = {}) {
        this.cdkOutDir = cdkOutDir;
        this.templateFiles = [];
        this.apis = new Map();
        this.lambdaFunctions = new Map();
        this.lambdaLayers = new Map();
        this.apiAuthorizers = new Map();
        this.assetMapping = new Map();
        this.layerImportMapping = new Map();

        // Environment configuration options
        this.environmentConfig = this.buildEnvironmentConfig(options);

        // Layer caching options
        this.useLayerCache = options.useLayerCache || false;
        this.layerCacheDir = options.layerCacheDir || null;
    }

    /**
     * Build environment configuration with defaults and overrides
     */
    buildEnvironmentConfig(options = {}) {
        // Load default local configuration from file
        const defaultConfig = this.loadDefaultConfiguration();

        // Start with base local configuration
        let config = { ...defaultConfig };

        // Override with any custom environment variables provided via CLI
        if (options.customEnvironment) {
            config = { ...config, ...options.customEnvironment };
        }

        return config;
    }

    /**
     * Load default local configuration from sam-config.json
     */
    loadDefaultConfiguration() {
        const configPath = path.join(__dirname, 'sam-config.json');

        try {
            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf8');
                return JSON.parse(content);
            }
        } catch (error) {
            console.warn(`⚠️  Warning: Could not load default config from ${configPath}: ${error.message}`);
        }

        // Fallback to hardcoded local defaults if config file doesn't exist
        return {
            AWS_ACCESS_KEY_ID: 'dummy',
            AWS_SECRET_ACCESS_KEY: 'dummy',
            AWS_DEFAULT_REGION: 'ca-central-1',
            AWS_REGION: 'ca-central-1',
            DYNAMODB_ENDPOINT_URL: 'http://localhost:8000',
            TABLE_NAME: 'reserve-rec-local',
            AUDIT_TABLE_NAME: 'Audit-local',
            PUBSUB_TABLE_NAME: 'reserve-rec-pubsub-local',
            REFERENCE_DATA_TABLE_NAME: 'reference-data-local',
            GLOBALID_INDEX_NAME: 'globalId-index',
            OPENSEARCH_DOMAIN_ENDPOINT: 'http://localhost:9200',
            OPENSEARCH_REFERENCE_DATA_INDEX_NAME: 'reference-data-index',
            OPENSEARCH_AUDIT_INDEX_NAME: 'audit-index',
            OPENSEARCH_BOOKING_INDEX_NAME: 'booking-index',
            OPENSEARCH_DOMAIN_NAME: 'local-opensearch-domain',
            IS_OFFLINE: 'true',
            NODE_ENV: 'development',
            LOG_LEVEL: 'debug',
            TZ: 'America/Vancouver'
        };
    }

    /**
     * Main execution method
     */
    async generate() {
        console.log('🚀 Starting SAM template generation from CDK templates...');

        // Step 1: Find all CloudFormation template files
        this.findTemplateFiles();

        // Step 2: Parse each template file
        for (const templateFile of this.templateFiles) {
            await this.parseTemplate(templateFile);
        }

        // Step 3: Generate SAM templates for each API
        this.generateSAMTemplates();

        console.log('✅ SAM template generation completed!');
    }

    /**
     * Find all CloudFormation template files in the cdk.out directory
     * Only includes templates for the local environment (containing "-Local-" in the name)
     */
    findTemplateFiles() {
        const files = fs.readdirSync(this.cdkOutDir);
        this.templateFiles = files
            .filter(file => file.endsWith('.template.json'))
            .filter(file => file.includes('-Local-'))
            .map(file => path.join(this.cdkOutDir, file));

        console.log(`📁 Found ${this.templateFiles.length} local environment CloudFormation template files:`);
        this.templateFiles.forEach(file => console.log(`   - ${path.basename(file)}`));
    }

    /**
     * Parse a CloudFormation template file
     */
    async parseTemplate(templateFile) {
        console.log(`\n📄 Parsing template: ${path.basename(templateFile)}`);

        try {
            const templateContent = fs.readFileSync(templateFile, 'utf8');
            const template = JSON.parse(templateContent);

            if (!template.Resources) {
                console.log('   ⚠️  No resources found in template');
                return;
            }

            // Extract APIs, Lambda functions, layers, authorizers, and assets
            this.extractAPIs(template, templateFile);
            this.extractLambdaFunctions(template, templateFile);
            this.extractLambdaLayers(template, templateFile);
            this.extractAPIAuthorizers(template, templateFile);
            this.extractAssets(template, templateFile);

        } catch (error) {
            console.error(`   ❌ Error parsing template: ${error.message}`);
        }
    }

    /**
     * Extract API Gateway REST APIs from template
     */
    extractAPIs(template, templateFile) {
        const stackName = path.basename(templateFile, '.template.json');

        Object.entries(template.Resources).forEach(([resourceId, resource]) => {
            if (resource.Type === 'AWS::ApiGateway::RestApi') {
                const apiInfo = {
                    resourceId,
                    stackName,
                    templateFile,
                    properties: resource.Properties,
                    methods: [],
                    resources: [],
                    lambdaIntegrations: new Map()
                };

                // Find associated methods and resources
                this.findAPIComponents(template, resourceId, apiInfo);

                this.apis.set(resourceId, apiInfo);
                console.log(`   🔗 Found API: ${resource.Properties.Name || resourceId}`);
            }
        });
    }

    /**
     * Find API Gateway methods and resources associated with an API
     */
    findAPIComponents(template, apiResourceId, apiInfo) {
        Object.entries(template.Resources).forEach(([resourceId, resource]) => {
            // Find API Gateway Resources
            if (resource.Type === 'AWS::ApiGateway::Resource' &&
                resource.Properties.RestApiId &&
                resource.Properties.RestApiId.Ref === apiResourceId) {

                apiInfo.resources.push({
                    resourceId,
                    pathPart: resource.Properties.PathPart,
                    parentId: this.extractParentId(resource.Properties.ParentId)
                });
            }

            // Find API Gateway Methods
            if (resource.Type === 'AWS::ApiGateway::Method' &&
                resource.Properties.RestApiId &&
                resource.Properties.RestApiId.Ref === apiResourceId) {

                const methodInfo = {
                    resourceId,
                    httpMethod: resource.Properties.HttpMethod,
                    authorizationType: resource.Properties.AuthorizationType,
                    authorizerId: resource.Properties.AuthorizerId,
                    apiResourceId: resource.Properties.ResourceId,
                    integration: resource.Properties.Integration
                };

                // Extract Lambda function ARN from integration
                if (methodInfo.integration && methodInfo.integration.Uri) {
                    this.extractLambdaFromIntegration(methodInfo, apiInfo);
                }

                apiInfo.methods.push(methodInfo);
            }
        });
    }

    /**
     * Extract parent ID from CloudFormation reference
     */
    extractParentId(parentIdRef) {
        if (!parentIdRef) return null;

        if (parentIdRef.Ref) {
            return parentIdRef.Ref;
        } else if (parentIdRef['Fn::GetAtt']) {
            // This is the root resource, we'll treat it as null parent
            return null;
        }

        return null;
    }

    /**
     * Extract Lambda function ARN from API Gateway integration
     */
    extractLambdaFromIntegration(methodInfo, apiInfo) {
        const integration = methodInfo.integration;

        if (integration.Type === 'AWS_PROXY' && integration.Uri) {
            let lambdaReference = null;

            if (integration.Uri['Fn::Join']) {
                // Handle CloudFormation intrinsic functions
                const joinParts = integration.Uri['Fn::Join'][1];
                const lambdaArnPart = joinParts.find(part =>
                    part['Fn::ImportValue'] || part['Fn::GetAtt']
                );

                if (lambdaArnPart) {
                    lambdaReference = {
                        type: lambdaArnPart['Fn::ImportValue'] ? 'import' : 'getatt',
                        value: lambdaArnPart['Fn::ImportValue'] ||
                               (lambdaArnPart['Fn::GetAtt'] && lambdaArnPart['Fn::GetAtt'][0])
                    };
                }
            }

            if (lambdaReference) {
                const path = this.buildResourcePath(methodInfo.apiResourceId, apiInfo);
                const key = `${methodInfo.httpMethod}:${path}`;
                apiInfo.lambdaIntegrations.set(key, lambdaReference);
                console.log(`     🔗 Found integration: ${key} -> ${lambdaReference.type}:${lambdaReference.value}`);
            }
        }
    }

    /**
     * Build resource path from resource hierarchy
     */
    buildResourcePath(resourceRef, apiInfo) {
        if (!resourceRef || !resourceRef.Ref) {
            return '/';
        }

        const resource = apiInfo.resources.find(r => r.resourceId === resourceRef.Ref);
        if (!resource) {
            return '/';
        }

        // Recursively build the full path by traversing up the parent resources
        let parts = [];
        let current = resource;
        while (current) {
            if (current.pathPart) {
                parts.unshift(current.pathPart);
            }
            if (current.parentId) {
                current = apiInfo.resources.find(r => r.resourceId === current.parentId);
            } else {
                break;
            }
        }
        return '/' + parts.join('/');
    }

    /**
     * Extract Lambda functions from template
     */
    extractLambdaFunctions(template, templateFile) {
        const stackName = path.basename(templateFile, '.template.json');

        Object.entries(template.Resources).forEach(([resourceId, resource]) => {
            if (resource.Type === 'AWS::Lambda::Function') {
                const functionInfo = {
                    resourceId,
                    stackName,
                    templateFile,
                    properties: resource.Properties,
                    handler: resource.Properties.Handler,
                    runtime: resource.Properties.Runtime,
                    codeUri: this.resolveCodeUri(resource.Properties.Code),
                    environment: resource.Properties.Environment?.Variables || {},
                    layers: this.extractLayerReferences(resource.Properties.Layers || [])
                };

                this.lambdaFunctions.set(resourceId, functionInfo);
                console.log(`   🔧 Found Lambda: ${resource.Properties.FunctionName || resourceId}`);

                if (functionInfo.layers.length > 0) {
                    console.log(`     📦 Layers: ${functionInfo.layers.map(l => l.type === 'import' ? l.value : l.value).join(', ')}`);
                }
            }
        });
    }

    /**
     * Extract layer references from Lambda function layers array
     */
    extractLayerReferences(layersArray) {
        if (!Array.isArray(layersArray)) return [];

        return layersArray.map(layer => {
            if (layer['Fn::ImportValue']) {
                return {
                    type: 'import',
                    value: layer['Fn::ImportValue']
                };
            } else if (layer['Fn::GetAtt']) {
                return {
                    type: 'getatt',
                    value: layer['Fn::GetAtt'][0]
                };
            } else if (layer.Ref) {
                return {
                    type: 'ref',
                    value: layer.Ref
                };
            } else if (typeof layer === 'string') {
                return {
                    type: 'direct',
                    value: layer
                };
            }
            return null;
        }).filter(Boolean);
    }

    /**
     * Extract Lambda layers from template
     */
    extractLambdaLayers(template, templateFile) {
        const stackName = path.basename(templateFile, '.template.json');

        Object.entries(template.Resources).forEach(([resourceId, resource]) => {
            if (resource.Type === 'AWS::Lambda::LayerVersion') {
                const layerInfo = {
                    resourceId,
                    stackName,
                    templateFile,
                    properties: resource.Properties,
                    compatibleRuntimes: resource.Properties.CompatibleRuntimes || [],
                    description: resource.Properties.Description,
                    licenseInfo: resource.Properties.LicenseInfo,
                    contentUri: this.resolveLayerContentUri(resource.Properties.Content)
                };

                this.lambdaLayers.set(resourceId, layerInfo);
                console.log(`   📦 Found Layer: ${resourceId}`);

                // Map export names to layer resource IDs for import resolution
                if (template.Outputs) {
                    Object.entries(template.Outputs).forEach(([outputId, output]) => {
                        if (output.Export && output.Export.Name &&
                            output.Value && output.Value.Ref === resourceId) {
                            this.layerImportMapping.set(output.Export.Name, resourceId);
                            console.log(`     🔗 Export mapping: ${output.Export.Name} -> ${resourceId}`);
                        }
                    });
                }
            }
        });
    }

    /**
     * Resolve layer content URI from CDK assets
     */
    resolveLayerContentUri(contentProperty) {
        if (!contentProperty) return './';

        if (contentProperty.S3Key) {
            // Map S3 key to local asset path
            const assetPath = this.findAssetPath(contentProperty.S3Key);
            return assetPath || './';
        }

        return './';
    }

    /**
     * Get layer source path for simplified layer names
     */
    getLayerSourcePath(layerType) {
        // Check if we should use cached layers
        if (this.useLayerCache) {
            const cachedPath = LayerBuilder.getCachePathForLayer(layerType, this.layerCacheDir);

            if (LayerBuilder.isCached(layerType, this.layerCacheDir)) {
                console.log(`     🚀 Using cached layer: ${layerType} -> ${cachedPath}`);
                return cachedPath;
            } else {
                console.log(`     ⚠️  Cached layer not found: ${layerType}, falling back to source`);
            }
        }

        // Fallback to original source paths
        const projectRoot = path.resolve(this.cdkOutDir, '..');

        switch(layerType) {
            case 'BaseLayer':
                return path.join(projectRoot, 'src/layers/base');
            case 'AwsUtilsLayer':
                return path.join(projectRoot, 'src/layers/awsUtils');
            case 'DataUtilsLayer':
                return path.join(projectRoot, 'src/layers/dataUtils');
            case 'JwtLayer':
                return path.join(projectRoot, 'src/layers/jwt');
            default:
                return './';
        }
    }

    /**
     * Map layer description to source directory
     */
    mapLayerToSourceDirectory(layerInfo) {
        const description = layerInfo.description || '';
        const projectRoot = path.resolve(this.cdkOutDir, '..');

        if (description.includes('Base layer')) {
            return path.join(projectRoot, 'src/layers/base');
        } else if (description.includes('AWS Utils layer')) {
            return path.join(projectRoot, 'src/layers/awsUtils');
        } else if (description.includes('Data Utils layer')) {
            return path.join(projectRoot, 'src/layers/dataUtils');
        } else if (description.includes('JWT layer')) {
            return path.join(projectRoot, 'src/layers/jwt');
        }

        // Fallback to asset path if no mapping found
        return layerInfo.contentUri || './';
    }

    /**
     * Get layer-required environment variables for functions that use layers
     */
    getLayerRequiredEnvironmentVariables() {
        return { ...this.environmentConfig };
    }

    /**
     * Resolve SSM parameter references and CloudFormation intrinsic functions
     * to use values from sam-config.json instead
     */
    resolveEnvironmentVariableReferences(environmentVariables) {
        const resolved = {};

        for (const [key, value] of Object.entries(environmentVariables)) {
            if (typeof value === 'object' && value !== null) {
                // Check for CloudFormation Ref to SSM parameters
                if (value.Ref && value.Ref.includes('SsmParameterValue')) {
                    // Map SSM parameter references to sam-config values
                    const configValue = this.mapSsmParameterToConfigValue(key, value.Ref);
                    if (configValue !== undefined) {
                        resolved[key] = configValue;
                        console.log(`     🔧 Resolved SSM parameter ${key}: ${value.Ref} -> ${configValue}`);
                    } else {
                        // Fallback to sam-config value if available
                        resolved[key] = this.environmentConfig[key] || value;
                    }
                } else if (value['Fn::Join']) {
                    // Handle Fn::Join constructs
                    const configValue = this.mapSsmParameterToConfigValue(key);
                    if (configValue !== undefined) {
                        resolved[key] = configValue;
                        console.log(`     🔧 Resolved Fn::Join ${key} -> ${configValue}`);
                    } else {
                        resolved[key] = this.environmentConfig[key] || value;
                    }
                } else {
                    // Other object types - try to resolve from config
                    resolved[key] = this.environmentConfig[key] || value;
                }
            } else {
                // Simple string/number values - use as-is unless overridden in config
                resolved[key] = this.environmentConfig[key] || value;
            }
        }

        return resolved;
    }

    /**
     * Map SSM parameter references to corresponding sam-config.json values
     */
    mapSsmParameterToConfigValue(envVarName, ssmParameterRef = '') {
        // Map environment variable names to their sam-config equivalents
        const mappings = {
            'OPENSEARCH_DOMAIN_ENDPOINT': 'OPENSEARCH_DOMAIN_ENDPOINT',
            'OPENSEARCH_REFERENCE_DATA_INDEX_NAME': 'OPENSEARCH_REFERENCE_DATA_INDEX_NAME',
            'OPENSEARCH_AUDIT_INDEX_NAME': 'OPENSEARCH_AUDIT_INDEX_NAME',
            'OPENSEARCH_BOOKING_INDEX_NAME': 'OPENSEARCH_BOOKING_INDEX_NAME',
            'REFERENCE_DATA_TABLE_NAME': 'REFERENCE_DATA_TABLE_NAME',
            'TRANSACTIONAL_DATA_TABLE_NAME': 'TRANSACTIONAL_DATA_TABLE_NAME',
            'AUDIT_TABLE_NAME': 'AUDIT_TABLE_NAME',
            'PUBSUB_TABLE_NAME': 'PUBSUB_TABLE_NAME'
        };

        const configKey = mappings[envVarName];
        if (configKey && this.environmentConfig[configKey] !== undefined) {
            return this.environmentConfig[configKey];
        }

        return undefined;
    }

    /**
     * Ensure functions using layers have all required environment variables
     */
    ensureLayerEnvironmentVariables(functionEnvironment, layers) {
        const layerRequiredVars = this.getLayerRequiredEnvironmentVariables();

        // First resolve any SSM parameter references in function environment
        const resolvedFunctionEnvironment = this.resolveEnvironmentVariableReferences(functionEnvironment);

        // Then merge with layer-required variables (sam-config takes precedence)
        const mergedEnvironment = { ...layerRequiredVars, ...resolvedFunctionEnvironment };

        if (layers && layers.length > 0) {
            console.log(`     🔧 Function uses ${layers.length} layer(s), ensuring layer-required environment variables are available`);

            // Check if any critical layer variables are missing
            const criticalVars = ['AWS_REGION', 'IS_OFFLINE', 'TABLE_NAME', 'DYNAMODB_ENDPOINT_URL'];
            const missingVars = criticalVars.filter(varName => !mergedEnvironment[varName]);

            if (missingVars.length > 0) {
                console.log(`     ⚠️  Adding missing critical environment variables for layers: ${missingVars.join(', ')}`);
            }
        }

        return mergedEnvironment;
    }

    /**
     * Merge global environment variables with function-specific ones
     * sam-config.json values take precedence over CDK template SSM references
     */
    mergeEnvironmentVariables(functionEnvironment = {}, layers = []) {
        return this.ensureLayerEnvironmentVariables(functionEnvironment, layers);
    }

    /**
     * Extract API Gateway authorizers from template
     */
    extractAPIAuthorizers(template, templateFile) {
        const stackName = path.basename(templateFile, '.template.json');

        Object.entries(template.Resources).forEach(([resourceId, resource]) => {
            if (resource.Type === 'AWS::ApiGateway::Authorizer') {
                const authorizerInfo = {
                    resourceId,
                    stackName,
                    templateFile,
                    properties: resource.Properties,
                    name: resource.Properties.Name,
                    type: resource.Properties.Type,
                    authorizerUri: resource.Properties.AuthorizerUri,
                    identitySource: resource.Properties.IdentitySource,
                    authorizerResultTtlInSeconds: resource.Properties.AuthorizerResultTtlInSeconds,
                    restApiId: resource.Properties.RestApiId
                };

                this.apiAuthorizers.set(resourceId, authorizerInfo);
                console.log(`   🔐 Found Authorizer: ${resource.Properties.Name || resourceId} (Type: ${resource.Properties.Type})`);
            }
        });
    }    /**
     * Resolve Lambda function code URI from CDK assets
     */
    resolveCodeUri(codeProperty) {
        if (!codeProperty) return './';

        if (codeProperty.S3Key) {
            // Map S3 key to local asset path
            const assetPath = this.findAssetPath(codeProperty.S3Key);
            return assetPath || './';
        }

        return './';
    }

    /**
     * Find local asset path for S3 key
     */
    findAssetPath(s3Key) {
        // Look for asset directories in cdk.out that match the S3 key
        const assetDirs = fs.readdirSync(this.cdkOutDir)
            .filter(item => item.startsWith('asset.'))
            .filter(item => {
                // Check if the asset directory name matches the S3 key
                const assetId = item.replace('asset.', '');
                return s3Key.includes(assetId);
            });

        if (assetDirs.length > 0) {
            return path.join(this.cdkOutDir, assetDirs[0]);
        }

        // Fallback: return the first asset directory found
        const allAssetDirs = fs.readdirSync(this.cdkOutDir)
            .filter(item => item.startsWith('asset.'))
            .map(item => path.join(this.cdkOutDir, item));

        return allAssetDirs.length > 0 ? allAssetDirs[0] : './';
    }

    /**
     * Extract asset information
     */
    extractAssets(template, templateFile) {
        // Extract asset metadata from CDK metadata
        Object.entries(template.Resources).forEach(([resourceId, resource]) => {
            if (resource.Metadata && resource.Metadata['aws:asset:path']) {
                this.assetMapping.set(resourceId, {
                    path: resource.Metadata['aws:asset:path'],
                    isBundled: resource.Metadata['aws:asset:is-bundled']
                });
            }
        });
    }

    /**
     * Generate SAM templates for each API
     */
    generateSAMTemplates() {
        console.log(`\n🏗️  Generating SAM templates for ${this.apis.size} APIs...`);

        this.apis.forEach((apiInfo, apiId) => {
            const samTemplate = this.createSAMTemplate(apiInfo);
            const outputFile = path.join(
                this.cdkOutDir,
                `sam-${apiInfo.properties.Name || apiId}.yaml`
            );

            this.writeSAMTemplate(samTemplate, outputFile);
            console.log(`   📝 Generated: ${path.basename(outputFile)}`);
        });
    }

    /**
     * Create SAM template structure
     */
    createSAMTemplate(apiInfo) {
        const samTemplate = {
            AWSTemplateFormatVersion: '2010-09-09',
            Transform: 'AWS::Serverless-2016-10-31',
            Description: `SAM template for ${apiInfo.properties.Name || apiInfo.resourceId}`,
            Globals: {
                Function: {
                    Runtime: 'nodejs20.x',
                    Timeout: 30,
                    Environment: {
                        Variables: this.getLayerRequiredEnvironmentVariables()
                    }
                }
            },
            Resources: {}
        };

        // Add API Gateway
        const apiDefinition = {
            Type: 'AWS::Serverless::Api',
            Properties: {
                StageName: 'local',
                Name: apiInfo.properties.Name || apiInfo.resourceId,
                Description: apiInfo.properties.Description || 'Generated from CDK template',
                Cors: {
                    AllowMethods: "\"'*'\"",
                    AllowHeaders: "\"'*'\"",
                    AllowOrigin: "\"'*'\"",
                    MaxAge: "\"'600'\""
                }
            }
        };

        // Add authorizers to API definition if any exist
        // Skip authorizers for local development to bypass authentication
        const apiAuthorizers = this.getAuthorizersForAPI(apiInfo);
        if (Object.keys(apiAuthorizers).length > 0) {
            // For local development, skip adding authorizers to bypass authentication
            console.log(`   🔓 Skipping ${Object.keys(apiAuthorizers).length} API authorizer(s) for local development`);
            // apiDefinition.Properties.Auth = {
            //     Authorizers: apiAuthorizers
            // };
        }

        samTemplate.Resources[apiInfo.resourceId] = apiDefinition;

                // Add Lambda functions and API events
        this.addLambdaFunctionsToSAM(samTemplate, apiInfo);

        // Add Lambda layers
        this.addLambdaLayersToSAM(samTemplate, apiInfo);

        // Skip API Gateway authorizers for local development
        // this.addAuthorizersToSAM(samTemplate, apiInfo);
        console.log('   🔓 Skipping authorizers for local development (no authentication required)');

        return samTemplate;
    }

    /**
     * Add Lambda functions and their API Gateway events to SAM template
     */
    addLambdaFunctionsToSAM(samTemplate, apiInfo) {
        const processedFunctions = new Set();

        console.log(`   🔍 Processing ${apiInfo.methods.length} methods for API: ${apiInfo.properties.Name}`);

        apiInfo.methods.forEach(method => {
            if (method.httpMethod === 'OPTIONS') {
                return; // Skip OPTIONS methods for now
            }

            const path = this.buildResourcePath(method.apiResourceId, apiInfo);
            const integrationKey = `${method.httpMethod}:${path}`;
            const lambdaReference = apiInfo.lambdaIntegrations.get(integrationKey);

            console.log(`   📍 Processing ${integrationKey}`);

            if (lambdaReference) {
                // Find the actual Lambda function
                const lambdaFunction = this.findLambdaByReference(lambdaReference);

                if (lambdaFunction && !processedFunctions.has(lambdaFunction.resourceId)) {
                    console.log(`   ✅ Adding Lambda function: ${lambdaFunction.resourceId}`);

                    // Add Lambda function to SAM template
                    const resolvedLayers = this.resolveLambdaLayers(lambdaFunction.layers);

                    // Merge global environment variables with function-specific ones, considering layer requirements
                    const mergedEnvironment = this.mergeEnvironmentVariables(lambdaFunction.environment, lambdaFunction.layers);

                    samTemplate.Resources[lambdaFunction.resourceId] = {
                        Type: 'AWS::Serverless::Function',
                        Properties: {
                            CodeUri: lambdaFunction.codeUri,
                            Handler: lambdaFunction.handler,
                            Runtime: lambdaFunction.runtime,
                            Environment: {
                                Variables: mergedEnvironment
                            },
                            Events: {}
                        }
                    };

                    // Add layers if any
                    if (resolvedLayers.length > 0) {
                        samTemplate.Resources[lambdaFunction.resourceId].Properties.Layers = resolvedLayers;
                        console.log(`     📦 Added ${resolvedLayers.length} layers to function`);
                    }

                    processedFunctions.add(lambdaFunction.resourceId);
                }

                // Add API Gateway event
                if (lambdaFunction) {
                    const eventName = `${method.httpMethod}${path.replace(/[\/\-]/g, '')}Event`;
                    if (!samTemplate.Resources[lambdaFunction.resourceId].Properties.Events[eventName]) {
                        const eventProperties = {
                            Type: 'Api',
                            Properties: {
                                RestApiId: { Ref: apiInfo.resourceId },
                                Path: path,
                                Method: method.httpMethod
                            }
                        };

                        // Add authorizer reference if method uses custom authorization
                        // Skip authorizers for local development to bypass authentication
                        if (method.authorizationType === 'CUSTOM' && method.authorizerId) {
                            const authorizerResourceId = method.authorizerId.Ref;
                            const authorizerInfo = this.apiAuthorizers.get(authorizerResourceId);
                            if (authorizerInfo && authorizerInfo.samAuthorizerName) {
                                // For local development, skip adding authorizers to bypass authentication
                                console.log(`     🔓 Skipping authorizer for local development: ${authorizerInfo.samAuthorizerName}`);
                                // eventProperties.Properties.Auth = {
                                //     Authorizer: authorizerInfo.samAuthorizerName
                                // };
                                // console.log(`     🔐 Added authorizer to event: ${authorizerInfo.samAuthorizerName}`);
                            }
                        }

                        samTemplate.Resources[lambdaFunction.resourceId].Properties.Events[eventName] = eventProperties;
                        console.log(`     📌 Added event: ${eventName} (${method.httpMethod} ${path})`);
                    }
                }
            } else {
                console.log(`   ⚠️  No Lambda integration found for ${integrationKey}`);
            }
        });

        console.log(`   📊 Added ${processedFunctions.size} unique Lambda functions to SAM template`);
    }

    /**
     * Resolve Lambda layer references to SAM template references
     */
    resolveLambdaLayers(layerReferences) {
        return layerReferences.map(layerRef => {
            if (layerRef.type === 'import') {
                // Find the corresponding layer resource ID
                const layerResourceId = this.layerImportMapping.get(layerRef.value);
                if (layerResourceId) {
                    // For local development, check if this is an SSM parameter reference
                    if (layerResourceId.includes('SsmParameterValue')) {
                        // For SSM parameter references, create a simplified local layer reference
                        // Extract the layer type from the parameter name
                        let layerType = 'unknown';
                        if (layerResourceId.includes('baseLayer')) {
                            layerType = 'BaseLayer';
                        } else if (layerResourceId.includes('awsUtilsLayer')) {
                            layerType = 'AwsUtilsLayer';
                        } else if (layerResourceId.includes('dataUtilsLayer')) {
                            layerType = 'DataUtilsLayer';
                        } else if (layerResourceId.includes('jwtLayer')) {
                            layerType = 'JwtLayer';
                        }

                        // Return a simplified reference that SAM can understand
                        return { Ref: layerType };
                    } else {
                        return { Ref: layerResourceId };
                    }
                } else {
                    console.log(`     ⚠️  Could not resolve layer import: ${layerRef.value}`);
                    return null;
                }
            } else if (layerRef.type === 'ref') {
                // Check if this is an SSM parameter reference
                if (layerRef.value.includes('SsmParameterValue')) {
                    let layerType = 'unknown';
                    if (layerRef.value.includes('baseLayer')) {
                        layerType = 'BaseLayer';
                    } else if (layerRef.value.includes('awsUtilsLayer')) {
                        layerType = 'AwsUtilsLayer';
                    } else if (layerRef.value.includes('dataUtilsLayer')) {
                        layerType = 'DataUtilsLayer';
                    } else if (layerRef.value.includes('jwtLayer')) {
                        layerType = 'JwtLayer';
                    }
                    return { Ref: layerType };
                } else {
                    return { Ref: layerRef.value };
                }
            } else if (layerRef.type === 'getatt') {
                return { Ref: layerRef.value };
            } else if (layerRef.type === 'direct') {
                // Direct ARN reference - keep as is
                return layerRef.value;
            }
            return null;
        }).filter(Boolean);
    }

    /**
     * Add Lambda layers referenced by functions to SAM template
     */
    addLambdaLayersToSAM(samTemplate, apiInfo) {
        const processedLayers = new Set();
        const referencedLayers = new Set();

        // Collect layers from API integration Lambda functions
        apiInfo.methods.forEach(method => {
            if (method.httpMethod === 'OPTIONS') return;

            const path = this.buildResourcePath(method.apiResourceId, apiInfo);
            const integrationKey = `${method.httpMethod}:${path}`;
            const lambdaReference = apiInfo.lambdaIntegrations.get(integrationKey);

            if (lambdaReference) {
                const lambdaFunction = this.findLambdaByReference(lambdaReference);
                if (lambdaFunction && lambdaFunction.layers) {
                    lambdaFunction.layers.forEach(layerRef => {
                        this.collectLayerReference(layerRef, referencedLayers);
                    });
                }
            }
        });

        // Collect layers from authorizer Lambda functions associated with this API
        this.apiAuthorizers.forEach((authorizerInfo, authorizerId) => {
            if (authorizerInfo.restApiId &&
                authorizerInfo.restApiId.Ref === apiInfo.resourceId) {

                const lambdaFunction = this.findAuthorizerLambda(authorizerInfo.authorizerUri);
                if (lambdaFunction && lambdaFunction.layers) {
                    console.log(`     📦 Collecting layers from authorizer function: ${lambdaFunction.resourceId}`);
                    lambdaFunction.layers.forEach(layerRef => {
                        this.collectLayerReference(layerRef, referencedLayers);
                    });
                }
            }
        });

        // Add each referenced layer to the SAM template
        referencedLayers.forEach(layerResourceId => {
            // Check if this is a simplified layer name
            if (['BaseLayer', 'AwsUtilsLayer', 'DataUtilsLayer', 'JwtLayer'].includes(layerResourceId)) {
                if (!processedLayers.has(layerResourceId)) {
                    const sourceContentUri = this.getLayerSourcePath(layerResourceId);
                    samTemplate.Resources[layerResourceId] = {
                        Type: 'AWS::Serverless::LayerVersion',
                        Properties: {
                            ContentUri: sourceContentUri,
                            CompatibleRuntimes: ['nodejs18.x', 'nodejs20.x'],
                            Description: `${layerResourceId} for local development`
                        }
                    };
                    processedLayers.add(layerResourceId);
                    console.log(`   📦 Added simplified layer to SAM template: ${layerResourceId} -> ${sourceContentUri}`);
                }
            } else {
                // Handle regular layer resources
                const layerInfo = this.lambdaLayers.get(layerResourceId);
                if (layerInfo && !processedLayers.has(layerResourceId)) {
                    // Use source directory mapping for local development
                    const sourceContentUri = this.mapLayerToSourceDirectory(layerInfo);

                    samTemplate.Resources[layerResourceId] = {
                        Type: 'AWS::Serverless::LayerVersion',
                        Properties: {
                            ContentUri: sourceContentUri,
                            CompatibleRuntimes: layerInfo.compatibleRuntimes,
                            Description: layerInfo.description || `Layer from ${layerInfo.stackName}`
                        }
                    };

                    if (layerInfo.licenseInfo) {
                        samTemplate.Resources[layerResourceId].Properties.LicenseInfo = layerInfo.licenseInfo;
                    }

                    processedLayers.add(layerResourceId);
                    console.log(`   📦 Added layer to SAM template: ${layerResourceId} -> ${sourceContentUri}`);
                } else if (!layerInfo) {
                    console.log(`   ⚠️  Layer ${layerResourceId} not found in collected layers - may be from external stack`);
                }
            }
        });

        if (processedLayers.size > 0) {
            console.log(`   📊 Added ${processedLayers.size} unique Lambda layers to SAM template`);
        }
    }

    /**
     * Helper method to collect layer references consistently
     */
    collectLayerReference(layerRef, referencedLayers) {
        if (layerRef.type === 'import') {
            const layerResourceId = this.layerImportMapping.get(layerRef.value);
            if (layerResourceId) {
                // Check if this is an SSM parameter reference and convert to simplified name
                if (layerResourceId.includes('SsmParameterValue')) {
                    let simplifiedLayerName = null;
                    if (layerResourceId.includes('baseLayer')) {
                        simplifiedLayerName = 'BaseLayer';
                    } else if (layerResourceId.includes('awsUtilsLayer')) {
                        simplifiedLayerName = 'AwsUtilsLayer';
                    } else if (layerResourceId.includes('dataUtilsLayer')) {
                        simplifiedLayerName = 'DataUtilsLayer';
                    } else if (layerResourceId.includes('jwtLayer')) {
                        simplifiedLayerName = 'JwtLayer';
                    }

                    if (simplifiedLayerName) {
                        referencedLayers.add(simplifiedLayerName);
                        console.log(`     📦 Found imported layer (simplified): ${layerRef.value} -> ${simplifiedLayerName}`);
                    } else {
                        referencedLayers.add(layerResourceId);
                        console.log(`     📦 Found imported layer: ${layerRef.value} -> ${layerResourceId}`);
                    }
                } else {
                    referencedLayers.add(layerResourceId);
                    console.log(`     📦 Found imported layer: ${layerRef.value} -> ${layerResourceId}`);
                }
            } else {
                console.log(`     ⚠️  Import mapping not found for layer: ${layerRef.value}`);
            }
        } else if (layerRef.type === 'ref' || layerRef.type === 'getatt') {
            // Check if this is an SSM parameter reference
            if (layerRef.value.includes('SsmParameterValue')) {
                let simplifiedLayerName = null;
                if (layerRef.value.includes('baseLayer')) {
                    simplifiedLayerName = 'BaseLayer';
                } else if (layerRef.value.includes('awsUtilsLayer')) {
                    simplifiedLayerName = 'AwsUtilsLayer';
                } else if (layerRef.value.includes('dataUtilsLayer')) {
                    simplifiedLayerName = 'DataUtilsLayer';
                } else if (layerRef.value.includes('jwtLayer')) {
                    simplifiedLayerName = 'JwtLayer';
                }

                if (simplifiedLayerName) {
                    referencedLayers.add(simplifiedLayerName);
                    console.log(`     📦 Found direct layer reference (simplified): ${layerRef.value} -> ${simplifiedLayerName}`);
                } else {
                    referencedLayers.add(layerRef.value);
                    console.log(`     📦 Found direct layer reference: ${layerRef.value}`);
                }
            } else {
                referencedLayers.add(layerRef.value);
                console.log(`     📦 Found direct layer reference: ${layerRef.value}`);
            }
        }
    }

    /**
     * Find Lambda function by ARN reference
     */
    findLambdaByReference(lambdaReference) {
        if (!lambdaReference) return null;

        // Handle different types of references
        if (lambdaReference.type === 'import') {
            // Parse import value to find the Lambda function
            const importValue = lambdaReference.value;
            console.log(`     🔍 Looking for Lambda with import: ${importValue}`);

            // Look for matching export in other templates
            return this.findLambdaByExportName(importValue);

        } else if (lambdaReference.type === 'getatt') {
            // Direct reference within the same template
            const resourceId = lambdaReference.value;
            return this.lambdaFunctions.get(resourceId);
        }

        return null;
    }

    /**
     * Find Lambda function by export name across all templates
     */
    findLambdaByExportName(exportName) {
        // Parse the export name to extract meaningful parts
        // Example: "AdminApiStackLocalAdminLambdaStackLocal140ED3B5:ExportsOutputFnGetAttAdminLambdaStackLocalTrialFunction00448637ArnC7ECCFC5"
        const parts = exportName.split(':');
        if (parts.length > 1) {
            const stackExportPart = parts[1];
            // Extract function resource ID from export name
            const functionMatch = stackExportPart.match(/FnGetAtt(\w+)Arn/);
            if (functionMatch) {
                const resourceId = functionMatch[1];
                console.log(`     🎯 Mapped export to resource: ${resourceId}`);

                // Find Lambda function with matching or similar resource ID
                return Array.from(this.lambdaFunctions.values()).find(func =>
                    func.resourceId.includes(resourceId) ||
                    resourceId.includes(func.resourceId)
                );
            }
        }

        // Fallback: return any Lambda function from the matching stack
        const stackName = parts[0];
        return Array.from(this.lambdaFunctions.values()).find(func =>
            func.stackName.includes(stackName) || stackName.includes(func.stackName)
        );
    }

    /**
     * Get authorizers for a specific API
     */
    getAuthorizersForAPI(apiInfo) {
        const authorizers = {};

        // Find authorizers that belong to this API
        this.apiAuthorizers.forEach((authorizerInfo, authorizerId) => {
            if (authorizerInfo.restApiId &&
                authorizerInfo.restApiId.Ref === apiInfo.resourceId) {

                // Create a SAM-compatible authorizer name (alphanumeric only)
                const authorizerName = (authorizerInfo.name || authorizerId)
                    .replace(/[^a-zA-Z0-9]/g, '')
                    .substring(0, 50); // Limit length

                if (authorizerInfo.type === 'REQUEST') {
                    // Lambda REQUEST authorizer
                    const lambdaFunction = this.findAuthorizerLambda(authorizerInfo.authorizerUri);

                    authorizers[authorizerName] = {
                        FunctionArn: lambdaFunction ? { 'Fn::GetAtt': [lambdaFunction.resourceId, 'Arn'] } :
                                   this.extractLambdaArnFromUri(authorizerInfo.authorizerUri),
                        Identity: {
                            Headers: [authorizerInfo.identitySource.replace('method.request.header.', '')]
                        }
                    };

                    if (authorizerInfo.authorizerResultTtlInSeconds) {
                        authorizers[authorizerName].AuthorizerPayloadFormatVersion = '2.0';
                        authorizers[authorizerName].EnableSimpleResponses = true;
                    }
                } else if (authorizerInfo.type === 'TOKEN') {
                    // Lambda TOKEN authorizer
                    const lambdaFunction = this.findAuthorizerLambda(authorizerInfo.authorizerUri);

                    authorizers[authorizerName] = {
                        FunctionArn: lambdaFunction ? { 'Fn::GetAtt': [lambdaFunction.resourceId, 'Arn'] } :
                                   this.extractLambdaArnFromUri(authorizerInfo.authorizerUri),
                        Identity: {
                            Header: authorizerInfo.identitySource.replace('method.request.header.', '')
                        }
                    };
                }

                // Store the mapping for event references
                authorizerInfo.samAuthorizerName = authorizerName;

                console.log(`   🔐 Added authorizer to API: ${authorizerName} (${authorizerInfo.type})`);
            }
        });

        return authorizers;
    }

    /**
     * Find Lambda function for authorizer URI
     */
    findAuthorizerLambda(authorizerUri) {
        if (!authorizerUri) {
            return null;
        }

        // Handle direct Fn::GetAtt reference
        if (authorizerUri['Fn::GetAtt']) {
            const resourceRef = authorizerUri['Fn::GetAtt'][0];
            return this.lambdaFunctions.get(resourceRef);
        }

        // Handle Fn::Join structure that contains Fn::GetAtt
        if (authorizerUri['Fn::Join']) {
            const joinParts = authorizerUri['Fn::Join'][1];

            // Look for any Fn::GetAtt references in the join parts
            for (const part of joinParts) {
                if (part['Fn::GetAtt'] && part['Fn::GetAtt'][1] === 'Arn') {
                    const resourceRef = part['Fn::GetAtt'][0];
                    const lambdaFunction = this.lambdaFunctions.get(resourceRef);
                    if (lambdaFunction) {
                        return lambdaFunction;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Extract Lambda ARN from complex authorizer URI
     */
    extractLambdaArnFromUri(authorizerUri) {
        if (authorizerUri && authorizerUri['Fn::Join']) {
            // For complex Fn::Join structures, try to find the Lambda ARN part
            const joinParts = authorizerUri['Fn::Join'][1];
            const lambdaArnPart = joinParts.find(part =>
                part['Fn::GetAtt'] && part['Fn::GetAtt'][1] === 'Arn'
            );

            if (lambdaArnPart) {
                const lambdaResourceId = lambdaArnPart['Fn::GetAtt'][0];
                const lambdaFunction = this.lambdaFunctions.get(lambdaResourceId);
                return lambdaFunction ? { Ref: lambdaFunction.resourceId } : lambdaArnPart;
            }
        }

        return authorizerUri;
    }

    /**
     * Add authorizers to SAM template (for authorizer functions)
     * Skip for local development to bypass authentication
     */
    addAuthorizersToSAM(samTemplate, apiInfo) {
        const processedAuthorizerFunctions = new Set();

        // Add any Lambda functions used by authorizers
        this.apiAuthorizers.forEach((authorizerInfo, authorizerId) => {
            if (authorizerInfo.restApiId &&
                authorizerInfo.restApiId.Ref === apiInfo.resourceId) {

                const lambdaFunction = this.findAuthorizerLambda(authorizerInfo.authorizerUri);

                if (lambdaFunction && !processedAuthorizerFunctions.has(lambdaFunction.resourceId)) {
                    // Skip adding authorizer Lambda functions for local development
                    processedAuthorizerFunctions.add(lambdaFunction.resourceId);
                    console.log(`   🔓 Skipping authorizer Lambda function for local development: ${lambdaFunction.resourceId}`);

                    // // Add the authorizer Lambda function to the template
                    // // Merge global environment variables with function-specific ones, considering layer requirements
                    // const mergedEnvironment = this.mergeEnvironmentVariables(lambdaFunction.environment, lambdaFunction.layers);

                    // samTemplate.Resources[lambdaFunction.resourceId] = {
                    //     Type: 'AWS::Serverless::Function',
                    //     Properties: {
                    //         CodeUri: lambdaFunction.codeUri,
                    //         Handler: lambdaFunction.handler,
                    //         Runtime: lambdaFunction.runtime,
                    //         Environment: {
                    //             Variables: mergedEnvironment
                    //         }
                    //     }
                    // };

                    // // Add layers if any
                    // const resolvedLayers = this.resolveLambdaLayers(lambdaFunction.layers);
                    // if (resolvedLayers.length > 0) {
                    //     samTemplate.Resources[lambdaFunction.resourceId].Properties.Layers = resolvedLayers;
                    // }

                    // processedAuthorizerFunctions.add(lambdaFunction.resourceId);
                    // console.log(`   🔐 Added authorizer Lambda function: ${lambdaFunction.resourceId}`);
                }
            }
        });

        if (processedAuthorizerFunctions.size > 0) {
            console.log(`   📊 Added ${processedAuthorizerFunctions.size} authorizer Lambda functions to SAM template`);
        }
    }

    /**
     * Write SAM template to file
     */
    writeSAMTemplate(template, outputFile) {
        const yaml = this.convertToYAML(template);
        fs.writeFileSync(outputFile, yaml);
    }

    /**
     * Convert JSON template to YAML format
     */
    convertToYAML(obj, indent = 0) {
        const spaces = '  '.repeat(indent);
        let yaml = '';

        if (Array.isArray(obj)) {
            obj.forEach(item => {
                yaml += `${spaces}- ${this.convertToYAML(item, indent + 1).trim()}\n`;
            });
        } else if (typeof obj === 'object' && obj !== null) {
            Object.entries(obj).forEach(([key, value]) => {
                if (typeof value === 'object' && value !== null) {
                    yaml += `${spaces}${key}:\n`;
                    yaml += this.convertToYAML(value, indent + 1);
                } else {
                    const valueStr = typeof value === 'string' ?
                        (value.includes('\n') ? `|\n${spaces}  ${value.replace(/\n/g, `\n${spaces}  `)}` :
                         value.includes(' ') || value.includes(':') ? `"${value}"` : value) :
                        value;
                    yaml += `${spaces}${key}: ${valueStr}\n`;
                }
            });
        } else {
            return obj;
        }

        return yaml;
    }
}

// Argument parsing helper
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        customEnvironment: {}, // Custom environment variable overrides
        configFile: null,
        help: false,
        useLayerCache: false,
        layerCacheDir: null
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--config' || arg === '-c') {
            options.configFile = args[++i];
        } else if (arg === '--use-layer-cache') {
            options.useLayerCache = true;
        } else if (arg === '--layer-cache-dir') {
            options.layerCacheDir = args[++i];
        } else if (arg.startsWith('--var.') || arg.startsWith('-v.')) {
            // Parse custom environment variable: --var.TABLE_NAME=my-table
            const varPart = arg.startsWith('--var.') ? arg.substring(6) : arg.substring(3);
            const [key, value] = varPart.split('=');
            if (key && value !== undefined) {
                options.customEnvironment[key] = value;
            }
        } else if (arg.includes('=')) {
            // Parse key=value pairs as custom variables
            const [key, value] = arg.split('=');
            if (key && value !== undefined) {
                options.customEnvironment[key.toUpperCase()] = value;
            }
        }
    }

    return options;
}// Load configuration from file
function loadConfigFile(configPath) {
    if (!configPath || !fs.existsSync(configPath)) {
        return {};
    }

    try {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(content);
        return config;
    } catch (error) {
        console.warn(`⚠️  Warning: Could not load config file ${configPath}: ${error.message}`);
        return {};
    }
}

// Show help information
function showHelp() {
    console.log(`
🔧 SAM Template Generator - Local Development

Usage: node generate-sam-templates.js [options]

Options:
  -h, --help                    Show this help message
  -c, --config <file>          Load additional configuration from JSON file
  --use-layer-cache            Use pre-built cached layers (much faster)
  --layer-cache-dir <path>     Custom directory for cached layers (default: ./.layer-cache)
  --var.<KEY>=<value>          Override environment variable (e.g., --var.TABLE_NAME=my-table)
  <KEY>=<value>                Override environment variable (e.g., TABLE_NAME=my-table)

Layer Performance:
  To dramatically improve startup time, pre-build layers first:
    node build-lambda-layers.js
  Then use cached layers:
    node generate-sam-templates.js --use-layer-cache

Environment Variables (defined in sam-config.json):
  TABLE_NAME                           Main DynamoDB table name
  AUDIT_TABLE_NAME                     Audit table name
  PUBSUB_TABLE_NAME                    PubSub table name
  REFERENCE_DATA_TABLE_NAME            Reference data table name
  GLOBALID_INDEX_NAME                  Global ID index name for DynamoDB
  DYNAMODB_ENDPOINT_URL                DynamoDB endpoint
  OPENSEARCH_DOMAIN_ENDPOINT           OpenSearch domain endpoint
  OPENSEARCH_REFERENCE_DATA_INDEX_NAME Reference data index name for OpenSearch
  OPENSEARCH_AUDIT_INDEX_NAME          Audit index name for OpenSearch
  OPENSEARCH_BOOKING_INDEX_NAME        Booking index name for OpenSearch
  OPENSEARCH_DOMAIN_NAME               OpenSearch domain name
  AWS_REGION                           AWS region
  LOG_LEVEL                            Logging level
  NODE_ENV                             Node environment
  TZ                                   Timezone

Examples:
  # Use default local configuration
  node generate-sam-templates.js

  # Override specific variables
  node generate-sam-templates.js TABLE_NAME=my-custom-table AUDIT_TABLE_NAME=my-audit

  # Use variable override syntax
  node generate-sam-templates.js --var.TABLE_NAME=my-custom-test-table

  # Use custom config file (legacy support)
  node generate-sam-templates.js --config ./custom-config.json

Configuration:
- Default settings are defined in: sam-config.json
- CLI variables (--var.* or KEY=value) override defaults
- External config files override both defaults and CLI settings
- Only processes CDK templates for local environment (-Local- in filename)
`);
}

// Main execution
async function main() {
    const options = parseArguments();

    if (options.help) {
        showHelp();
        return;
    }

    console.log('📋 Using local development environment');

    // Load additional configuration from file if provided (for legacy support)
    const fileConfig = loadConfigFile(options.configFile);

    // Prepare options for the generator
    const generatorOptions = {
        customEnvironment: {
            ...fileConfig.environment, // Legacy config file format
            ...options.customEnvironment // CLI overrides
        },
        useLayerCache: options.useLayerCache,
        layerCacheDir: options.layerCacheDir
    };

    if (options.configFile) {
        console.log(`📋 Loaded additional configuration from: ${options.configFile}`);
    }

    if (Object.keys(generatorOptions.customEnvironment).length > 0) {
        console.log('🔧 Environment variable overrides:');
        Object.entries(generatorOptions.customEnvironment).forEach(([key, value]) => {
            console.log(`   ${key}=${value}`);
        });
    }

    // Show layer caching status
    if (generatorOptions.useLayerCache) {
        const cacheDir = generatorOptions.layerCacheDir ||
            path.join(__dirname, '..', '..', '..', '.layer-cache');
        console.log(`🚀 Using cached layers from: ${cacheDir}`);

        // Check if layers exist
        const layerTypes = ['BaseLayer', 'AwsUtilsLayer', 'DataUtilsLayer', 'JwtLayer'];
        const availableLayers = layerTypes.filter(layer =>
            LayerBuilder.isCached(layer, generatorOptions.layerCacheDir)
        );

        if (availableLayers.length === 0) {
            console.log('⚠️  No cached layers found. Run "node build-lambda-layers.js" first.');
        } else {
            console.log(`   Available: ${availableLayers.join(', ')}`);
        }
    } else {
        console.log('🐌 Using source directories (will trigger Docker builds)');
        console.log('💡 For faster startup, use: node build-lambda-layers.js && node generate-sam-templates.js --use-layer-cache');
    }

    const cdkOutDir = path.join(__dirname, '..', '..', '..', '..', 'cdk.out');

    if (!fs.existsSync(cdkOutDir)) {
        console.error('❌ CDK output directory not found. Please run "cdk synth" first.');
        process.exit(1);
    }

    const generator = new SAMTemplateGenerator(cdkOutDir, generatorOptions);
    await generator.generate();
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { SAMTemplateGenerator };