# SAM Template Generator for CDK

This directory contains scripts to generate AWS SAM templates from CDK CloudFormation templates, enabling local testing of your APIs using `sam local start-api`.

## 📁 Scripts

### 1. `generate-sam-templates.js`
Generates individual SAM templates for each API Gateway REST API found in your CDK output.

### 2. `sam-local-helper.js`
Provides usage instructions and utilities for working with the generated SAM templates.

## 🚀 Quick Start

### Step 1: Generate CDK Templates
First, ensure your CDK templates are up to date:
```bash
cdk synth
```

### Step 2: Generate SAM Templates
Run the SAM template generator:
```bash
node scripts/generate-sam-templates.js
```

This will:
- Scan all CloudFormation templates in `cdk.out/`
- Extract API Gateway REST APIs and their associated Lambda functions
- Generate individual SAM templates for each API (saved as `sam-<api-name>.yaml`)

### Step 3: Get Usage Instructions
Run the helper script to see how to use the generated templates:
```bash
node scripts/sam-local-helper.js
```

## 📋 Available Helper Commands

### List all generated SAM templates:
```bash
node scripts/sam-local-helper.js list
```

### Get instructions for a specific template:
```bash
node scripts/sam-local-helper.js AdminApi
```

### Validate templates:
```bash
node scripts/sam-local-helper.js validate
```

### Create test events:
```bash
node scripts/sam-local-helper.js AdminApi --create-test-event
```

## 🏃‍♂️ Running APIs Locally

Once you have generated SAM templates, you can run them locally:

### Start a local API server:
```bash
sam local start-api -t cdk.out/sam-AdminApiStack-Local-AdminApi.yaml --port 3000
```

### Test endpoints:
```bash
curl http://localhost:3000/test
```

### Invoke functions directly:
```bash
sam local invoke AdminLambdaStackLocalTrialFunction00448637 \
  -t cdk.out/sam-AdminApiStack-Local-AdminApi.yaml \
  -e test-event.json
```

## 🔧 How It Works

### Template Generation Process:

1. **Scan CDK Output**: The script reads all `*.template.json` files in `cdk.out/`

2. **Extract APIs**: Finds `AWS::ApiGateway::RestApi` resources and their associated:
   - Methods (`AWS::ApiGateway::Method`)
   - Resources (`AWS::ApiGateway::Resource`)
   - Lambda integrations (via `Uri` properties)

3. **Extract Lambda Functions**: Identifies `AWS::Lambda::Function` resources with:
   - Handler and runtime information
   - Environment variables
   - Layer references (both direct and cross-stack imports)

4. **Extract Lambda Layers**: Finds `AWS::Lambda::LayerVersion` resources and:
   - Maps export names to layer resource IDs
   - Resolves asset paths for layer content
   - Tracks compatible runtimes and licensing

5. **Map Cross-Stack References**: Resolves Lambda function and layer references across stacks:
   - Handles `Fn::ImportValue` for cross-stack references
   - Maps CDK asset paths to local directories
   - Links functions to their required layers

6. **Generate SAM Templates**: Creates SAM-compatible YAML templates with:
   - API Gateway definitions
   - Lambda function definitions with proper layer references
   - Lambda layer definitions with local content paths
   - Proper event mappings
   - CORS configuration

### Cross-Stack Reference Resolution:

The script handles complex CDK cross-stack references like:
```json
{
  "Fn::ImportValue": "AdminApiStackLocalAdminLambdaStackLocal140ED3B5:ExportsOutputFnGetAttAdminLambdaStackLocalTrialFunction00448637ArnC7ECCFC5"
}
```

It parses these to find the actual Lambda function across different stacks.

### Asset Path Mapping:

CDK assets (Lambda code) are mapped from S3 references to local paths:
```
S3Key: "4104d53e2570fd9626fd960ef6121cb2eb81d945456b197ddc4f14a9bd6ff474.zip"
↓
CodeUri: "/path/to/cdk.out/asset.4104d53e2570fd9626fd960ef6121cb2eb81d945456b197ddc4f14a9bd6ff474"
```

## 📊 Example Output

### Generated SAM Template Structure:
```yaml
AWSTemplateFormatVersion: 2010-09-09
Transform: AWS::Serverless-2016-10-31
Description: SAM template for AdminApiStack-Local-AdminApi

Globals:
  Function:
    Runtime: nodejs20.x
    Timeout: 30
    Environment:
      Variables:
        IS_OFFLINE: true
  Api:
    Cors:
      AllowMethods: "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'"
      AllowHeaders: "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
      AllowOrigin: "'*'"

Resources:
  AdminApiStackLocalAdminApiDA041652:
    Type: AWS::Serverless::Api
    Properties:
      StageName: local
      Name: AdminApiStack-Local-AdminApi

  AdminLambdaStackLocalTrialFunction00448637:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: ./asset.4104d53e2570fd9626fd960ef6121cb2eb81d945456b197ddc4f14a9bd6ff474
      Handler: index.handler
      Runtime: nodejs20.x
      Layers:
        - !Ref CoreStackLocalBaseLayerD9CF244D
      Events:
        GETtestEvent:
          Type: Api
          Properties:
            RestApiId: !Ref AdminApiStackLocalAdminApiDA041652
            Path: /test
            Method: GET

  CoreStackLocalBaseLayerD9CF244D:
    Type: AWS::Serverless::LayerVersion
    Properties:
      ContentUri: ./asset.70e06c47cecb94e8e68ab0ac71dfdf81c9c7f692a57c2f07ba66d82dc058bd45
      CompatibleRuntimes:
        - nodejs20.x
      Description: Base layer for Lambda functions in ReserveRecApi - local environment
      LicenseInfo: Apache-2.0
```

## ⚠️ Prerequisites

- **AWS SAM CLI**: [Installation Guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- **Docker**: Required for running Lambda functions locally
- **AWS Credentials**: Configure with `aws configure`
- **Node.js**: For running the generator scripts

## 🐛 Troubleshooting

### Common Issues:

1. **"No SAM templates found"**
   - Run `cdk synth` first
   - Ensure you're in the correct directory
   - Check that `cdk.out/` contains `*.template.json` files

2. **"Lambda function not found"**
   - The script may not be able to resolve cross-stack references
   - Check the console output for mapping details
   - Verify that Lambda functions exist in the CDK templates

3. **"CodeUri path not found"**
   - CDK assets may not be correctly mapped
   - Check that asset directories exist in `cdk.out/`
   - Ensure CDK synthesis completed successfully

4. **SAM validation errors**
   - Run `node scripts/sam-local-helper.js validate` to check templates
   - Verify SAM CLI is installed correctly
   - Check template syntax in generated YAML files

### Debug Mode:

The generator script provides verbose output showing:
- Found APIs and Lambda functions
- Cross-stack reference resolution
- Asset path mapping
- Event generation

## 🔄 Updating Templates

When you make changes to your CDK code:

1. Re-synthesize: `cdk synth`
2. Re-generate SAM templates: `node scripts/generate-sam-templates.js`
3. Restart local API: `sam local start-api -t <template> --port 3000`

## 📝 Customization

You can modify the generator script to:
- Change SAM template structure
- Add custom environment variables
- Modify CORS settings
- Include additional AWS resources
- Handle different Lambda runtime configurations

The scripts are designed to be extensible and can be adapted for different CDK patterns and requirements.