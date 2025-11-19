# Reserve Recreation API

A comprehensive AWS CDK-based infrastructure project for managing park and recreation facility reservations. This system provides secure, scalable APIs for both administrative management and public booking functionality.

## Quick Start


### Installation & Setup

1. **Clone and install dependencies**:
  ```bash
  git clone <repository-url>
  cd reserve-rec-api
  yarn install
  ```

2. **Configure AWS credentials**:
  ```bash
  aws configure
  # Bootstrap CDK (first time only)
  cdk bootstrap
  ```

3. **Deploy to development environment**:
  ```bash
  yarn deploy:dev
  ```

### Local Development

For local testing and development:

```bash
# Start local admin API
yarn run:admin:full

# Start local public API
yarn run:public:full
```

### Key Sections

- **[🏗️ Architecture Overview](#️-architecture-overview)** - System design and stack relationships
- **[📚 Stack Descriptions](#-stack-descriptions)** - Detailed breakdown of each infrastructure component
- **[🛠️ Development Setup](#️-development-setup)** - Environment configuration and prerequisites
- **[🚀 Deployment](#-deployment)** - Local and remote deployment instructions
- **[🔒 Security Considerations](#-security-considerations)** - Authentication, authorization, and data protection
- **[🐛 Troubleshooting](#-troubleshooting)** - Common issues and debugging tips


## 🏗️ Architecture Overview

This project uses AWS Cloud Development Kit (CDK) to define infrastructure as code, consisting of a number of  interconnected stacks that provide a complete reservation management system:

```
┌─────────────────┐    ┌───────────────────┐    ┌─────────────────┐
│   Core Stack    │    │  Identity Stacks  │    │ OpenSearch Stack│
│                 │    │                   │    │                 │
│ • KMS Keys      │    │ • Admin Cognito   │    │ • Search Service│
│ • Lambda Layers │────│ • Public Cognito  │────│ • Fine-grained  │
│ • IAM Roles     │    │ • User Pools      │    │   Access Control│
└─────────────────┘    └───────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌───────────────────┐    ┌─────────────────┐
│  Data Stacks    │    │   API Stacks      │    │  Future Stacks  │
│                 │    │                   │    │                 │
│ • Reference     │────│ • Admin API       │────│                 │
│   Data (DDB)    │    │ • Public API      │    │                 │
│ • Transactional │    │ • REST Endpoints  │    │                 │
│   Data (DDB)    │    │ • Lambda Functions│    │                 │
└─────────────────┘    └───────────────────┘    └─────────────────┘
```

## 📚 Stack Descriptions

### 🔧 Core Stack (`coreStack`)
**Foundation services and shared resources**
- **KMS Keys**: Encryption for data at rest and in transit
- **Lambda Layers**: Shared code and dependencies (Base Layer, AWS Utils Layer)
- **API Gateway Logging**: Centralized API request/response logging
- **IAM Roles**: Cross-stack service permissions

### 🔐 Identity Stacks
**Authentication and authorization services**

#### Admin Identity Stack (`adminIdentityStack`)
- **Admin User Pool**: Cognito user pool for administrative users
- **Admin Identity Pool**: Identity pool for administrative users (Azure Login, BCSC Login)
- **Admin Groups**: Role-based access control (park managers, system admins)

#### Public Identity Stack (`publicIdentityStack`)
- **Public User Pool**: Cognito user pool for public users
- **Self-registration**: Email verification and password policies
- **Guest Access**: Limited functionality for non-registered users

### 🔍 OpenSearch Stack (`openSearchStack`)
**Search and analytics engine**
- **OpenSearch Domain**: Managed search service with fine-grained access control
- **Security**: IAM and FGAC integration with Cognito identity providers
- **Initialization Lambda**: Automated domain setup and index templates

### 💾 Data Stacks
**Persistent data storage and management**

#### Reference Data Stack (`referenceDataStack`)
- **DynamoDB Tables**: Park information, geozones, facilities, activities, products, policies, and other quasi-static configurations
- **Reference Data Streaming**: To synchronize OpenSearch `reference-data` indexes.
- **Audit Table**: For recording changes to static data
- **PubSub Table**: For webhook subscriptions

#### Transactional Data Stack (`transactionalDataStack`)
- **DynamoDB Tables**: Reservations, bookings, payments, and user activity
- **Transactional Data Streaming**: To synchronize OpenSearch `transactional-data` indexes.

### 🚀 API Stacks
**REST API endpoints and business logic**

#### Admin API Stack (`adminApiStack`)
- **Data Management Endpoints**: Park administration, user management, reporting
- **Lambda Functions**: Business logic for administrative operations
- **API Gateway**: RESTful endpoints with request validation
- **Authorization**: Integration with admin Cognito user pool

#### Public API Stack (`publicApiStack`)
- **Booking Endpoints**: Facility search, availability, reservation creation
- **Lambda Functions**: Public-facing business logic
- **Search Endpoints**: Public facing search logic

## 🛠️ Development Setup

### Prerequisites

- **Node.js**: Version 20 or higher
- **AWS CLI**: Version 2.x configured with appropriate credentials
- **AWS CDK**: Version 2.x

### Environment Configuration

The project supports multiple deployment environments configured via `cdk.json`:

```json
{
  "context": {
    "dev": {
      "DEPLOYMENT_NAME": "dev",
      "AWS_REGION": "ca-central-1",
      "IS_OFFLINE": "false",
      "FAIL_FAST": "false"
    },
    "test": {
      "DEPLOYMENT_NAME": "test",
      "AWS_REGION": "ca-central-1",
      "IS_OFFLINE": "false",
      "FAIL_FAST": "false"
    },
    "prod": {
      "DEPLOYMENT_NAME": "prod",
      "AWS_REGION": "ca-central-1",
      "IS_OFFLINE": "false",
      "FAIL_FAST": "false"
    },
    "local": {
      "DEPLOYMENT_NAME": "local",
      "AWS_REGION": "ca-central-1",
      "IS_OFFLINE": "true",
      "FAIL_FAST": "false"
    }
  }
}
```

- **DEPLOYMENT_NAME**: the name of the deployment (often the environment name)
- **AWS_REGION**: AWS region to deploy the app into (almost always `ca-central-1`)
- **IS_OFFLINE**: If `"true"`, the synthesizing/deployment operations will not attempt to connect to remote AWS servers for context/configuration variables (if synthesizing locally for example).
- **FAIL_FAST**: Abort synthesis of downstream stacks if an error occurs (useful for prototyping)

### Resource Naming Convention

The StackPrimer class enforces a consistent naming convention across all AWS resources to ensure uniqueness, traceability, and proper organization. This convention follows the pattern:

```
{AppName}-{DeploymentName}-{StackName}-{ResourceName}
```

#### Naming Components

- **AppName**: The application identifier (e.g., `ReserveRecApi`)
- **DeploymentName**: The environment or deployment instance (e.g., `Dev`, `Test`, `Prod`)
- **StackName**: The name of the relevant stack (e.g., `CoreStack`, `AdminApiStack`, `ReferenceDataStack`)
- **ResourceName**: The specific resource identifier within the stack

#### Examples

```javascript
// Lambda function in the Admin API stack
ReserveRecApi-Dev-AdminApiStack-UserManagementFunction

// DynamoDB table in the Reference Data stack
ReserveRecApi-Dev-ReferenceDataStack-ReferenceDataTable

// KMS key in the Core stack
ReserveRecApi-Test-CoreStack-DatabaseEncryptionKey

// Cognito User Pool in the Admin Identity stack
ReserveRecApi-Test-AdminIdentityStack-AdminUserPool
```

### Stack Dependencies

The system automatically manages stack dependencies. Deployment order is important, as the resources produced in some stacks are consumed by others. The current deployment order is:

1. CoreStack
2. AdminIndentityStack
3. PublicIdentityStack
4. OpenSearchStack
5. ReferenceDataStack
6. TransactionalDataStack
7. AdminApiStack
8. PublicApiStack

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd reserve-rec-api
   ```

2. **Install dependencies**:
   ```bash
   yarn
   ```

3. **Configure AWS credentials**:
   ```bash
   aws configure
   ```

4. **Bootstrap CDK (first time only)**:
   ```bash
    cdk bootstrap
   ```

## 🚀 Deployment

### Configuration Management

#### Environment-Specific Configuration
- **Context Resolution**: Environment settings loaded from `cdk.json`
- **SSM Parameter Store**: Runtime configuration stored in AWS Systems Manager
- **Secrets Manager**: Sensitive data stored securely in AWS Secrets Manager
- **Local Development**: Configuration loaded from `/src/scripts/tools/local-testing/sam-config.json` for offline testing

### Local Development

This application is optimized for deployment of multiple stacks into a remote AWS environment. Local deployment is possible, but not fully supported yet.

Local deployment uses AWS SAM to generate a local API for testing at `http://localhost:3000`. This necessitates a SAM template with which to generate the API.

CDK synth/deploy operations do not generate a SAM template, so a script has been written to extract the appropriate resources from the generated CDK templates and create a SAM template from them.

In an effort to reduce the amount of Docker containers used in local development (an issue that tends impedes rapid prototyping by slowing down repeated deployments), the construction of Lambda Layer `dists` that would otherwise occur as part of a local SAM API deployment has been extracted from the process. Lambda Layer construction can now occur separately from local SAM API deployment and only needs to be rerun if the contents of the layers change.

Additionally, this application now has multiple APIs, so each must be generated and deployed separately from one another. As of now there are two APIs:

* admin
* public

Variables that can be configured for local enviroment development are stored in `/src/scripts/tooling/local-testing/sam-config.json`.

For local development and testing:

```bash
# Synthesize CloudFormation templates locally
yarn synth:local

# Build Lambda layers for local testing
yarn build:layers

# Run script to generate SAM template from generated CDK templates
yarn build:<api> (admin or public)

# Start local API for admin functions
yarn run:<api> (admin or public)

# Do all the above in one step
yarn run:<api>:full (admin or public)

```

### Remote Environment Deployments

When deploying to a remote environment, it is important to ensure that the configuration variables for each stack are readily available in the remote AWS Parameter Store and Secrets Manager.

As per the [naming convention](#resource-naming-convention) of resources, each stack should have a `config` variable in Parameter Store that follows the pattern:

```
/{AppName}/{DeploymentName}/{StackName}/config
```
Example of the config parameter for CoreStack in the `dev` environment:
```
/reserveRecApi/dev/coreStack/config
```

Refer to the `defaults` variable in each stack instantiation file for the default structure of the stack's `config` parameter.


Deploy to specific environments:

```bash
# Development environment
yarn synth:dev (optional)
yarn deploy:dev

# Test environment
yarn synth:test (optional)
yarn deploy:test

# Prior to deployment, the log level can be set to inspect the deployment process
export LOG_LEVEL=debug
```


## 🏗️ CDKProject Architecture

### Core Classes

#### CDKProject Class
The main orchestrator that manages the entire deployment lifecycle:

```javascript
class CDKProject {
  // Application configuration
  getAppName()           // Returns "ReserveRecApi"
  getDeploymentName()    // Returns environment (dev/test/prod)
  getRegion()           // Returns AWS region
  isOffline()           // Checks if deploying offline
}
```

#### StackPrimer Class
Handles stack initialization and configuration resolution:

```javascript
class StackPrimer {
  // Stack setup
  prime()              // Initializes stack configuration
  nameConstructs()     // Generates CDK construct identifiers
  getDeploymentConfig() // Loads environment-specific settings
  getSecrets()         // Resolves AWS Secrets Manager values
}
```

#### BaseStack Class
Common functionality for all stacks:

```javascript
class BaseStack extends Stack {
  // Resource management
  createScopedId()     // Generates unique resource identifiers
  getConstructId()     // Gets the identifier of a construct
}
```

### Creating a Stack

Each stack has the the following structure:

* defaults
* stack definition (extends BaseStack)
* stack creation function

#### Defaults

Each stack declares default values for any variables or resources that it will create. The `defaults` variable at the head of each stack file has the following structure:

```javascript
const defaults = {
  constructs: {
    constructName: {
      name: 'ConstructName'
    }
  }
  config: {
    configVariable: "configValue"
  }
  secrets: {
    secretName: {
      name: 'SecretName'
    }
  }
}
```
* `constructs` contains a list of every construct/resource that the stack declares. To follow the same naming convention across deployments, construct names are standardized. To reference the standardized construct name, use `this.getConstructId('constructName'). For example:

```javascript
const defaults = {
  constructs: {
    tableName: {
      name: 'DynamoDBTableName'
    }
  }
}

class TableStack extends BaseStack {
  // ...

  const table = new dynamodb.Table(
    this,
    this.getConstructId('tableName'),
    { props }
  )
}

// Resulting table construct name:
// reserveRecApi/env/tableStack/dynamoDBTableName
```

* `config` contains a copy of the configuration file found in the [SSM config parameter](#remote-environment-deployments) for that stack. Values required by the stack but not provided in SSM will assume the `defaults.config` value via JS object merge. To reference config values in the stack, use `this.getConfigValue('configVariable'). For example:

```javascript
const defaults = {
  config: {
    defaultTimezone: 'America/Vancouver',
    overrides: {
      importedDynamoDBTableName: 'DynamoDBTable'
    }
  }
}

class TableStack extends BaseStack {
  // ...

  const tz = this.getConfigValue('defaultTimezome');

  const importedTableName = this.getConfigValue('overrides')?.importedDynamoDBTableName;

  if (importedTableName) {
    // use imported table reference
    this.table = dynamodb.Table.fromTableName(this, `${this.getConstructId('tableName')}-Imported`, importedTableName);
  } else {
    // initialize new DynamoDBTable
  }

  // Resulting table construct name:
  // reserveRecApi/env/tableStack/dynamoDBTableName-Imported

}
```

* `secrets` contains a list of secret names that the stack will look for in the remote AWS Secrets Manager. Secret names follow the same [naming convention](#naming-components) as components. To reference secret values in a stack, use `this.getSecretValue('secretName')`. For example:

```javascript
const defaults: {
  secrets: {
    osPassword: {
      name: 'OpenSearchMasterUserPassword'
    }
  }
}

class OpenSearchStack extends BaseStack {
  // ...

  const osMasterUserPW = this.getSecretValue('osPassword');

  // Script will check Secrets Manager for
  // reserveRecApi/env/openSearchStack/openSearchMasterUserPassword
}
```

In offline mode, the script will not look for secrets.

#### Stack Definition

To inherit functionality from the `CDKProject` class, all stacks should extend the `BaseStack` class.

```javascript
class NewStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);
  // ...
  }
}
```
* `scope`: Application scope (`CDKProject.this`)
* `primer`: Stack primer reference for the stack.

#### Stack Primer

Since JavaScript class constructors are synchronous, the `BaseStack` constructor cannot asynchronously look for remote `config` and `secrets` values prior to creating its constructs. Therefore, prior to instantiating a class, a `StackPrimer` is used for asynchronous configuration.

The `StackPrimer` class ingests `defaults` and fetches the remote `config` and `secrets` values, and generates the standardized construct names following the [naming convention](#naming-components). Its `prime()` function should be run before instantiating the stack.

```javascript
const primer = new StackPrimer(scope, stackKey, defaults);
// stackKey: any name for the stack, ie 'tableStack'
```

#### Stack Creation Function

The stack creation function is an asynchronous function that bundles the stack and the stack primer and returns the newly created stack. It is called by `CDKProject` to initialize the stack.

```javascript
async function createTableStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new TableStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating TableStack: ${error}`);
  }
}
```

### Cross-Stack Communication

In a multistack deployment, there are producer stacks and consumer stacks. Producer stacks initialize AWS resources/constructs and export their references to SSM. Consumer stacks import these references at deployment time. As a result, stacks can theoretically be deployed independently from one another, though it is always wise to not specify which stack needs deploying - `cdk deploy` will run through all stacks and determine which stacks need updating, and leave the rest unchanged.

#### Cross-Stack Referencing
```javascript
// Exporting from one stack (BaseStack method)
this.exportReference(scope, key, value, description);

this.exportReference(this, 'baseLayer' this.baseLayer, 'Lambda Layer containing basic shared functions');

// Importing in another stack (BaseStack method)
const importedReference = this.resolveReference(scope, key);

const baseLayer = this.resolveReference(this, 'baseLayer');
```

## 📝 Additional Resources

### AWS Documentation
- [AWS CDK Developer Guide](https://docs.aws.amazon.com/cdk/latest/guide/)
- [Amazon DynamoDB Developer Guide](https://docs.aws.amazon.com/dynamodb/)
- [Amazon OpenSearch Service Developer Guide](https://docs.aws.amazon.com/opensearch-service/)
- [Amazon Cognito Developer Guide](https://docs.aws.amazon.com/cognito/)

### Project-Specific Documentation
- `/docs/` - Detailed API documentation
- `/src/scripts/` - Deployment and utility scripts
- `/test/` - Test documentation and examples

---
