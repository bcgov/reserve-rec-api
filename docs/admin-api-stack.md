# Admin API Stack

The `AdminApiStack` provides the administrative REST API, authorizer, and all domain-specific Lambda functions for the Reserve Recreation system.

## Architecture Overview

The stack uses a **hub-and-spoke nested stack model** to stay well under CloudFormation's 500-resource-per-stack limit and to improve deployment parallelism.

```
AdminApiStack (root)
│
├── AdminApiCoreNestedStack   <- API Gateway + Authorizer (hub)
│
├── AdminActivitiesNestedStack
├── AdminBCSCNestedStack
├── AdminBookingsNestedStack
├── AdminConfigNestedStack
├── AdminFacilitiesNestedStack
├── AdminFeatureFlagsNestedStack
├── AdminGeozonesNestedStack
├── AdminPingNestedStack
├── AdminPoliciesNestedStack
├── AdminProductManagementNestedStack
├── AdminProductsNestedStack
├── AdminRelationshipsNestedStack
├── AdminReportsNestedStack
├── AdminSearchNestedStack
├── AdminUsersNestedStack
└── AdminVerifyNestedStack
```

### AdminApiCoreNestedStack (hub)

This nested stack owns the two resources every other nested stack depends on:

- **`RestApi`** — the API Gateway instance, created with `deploy: false` so the root stack controls the deployment lifecycle.
- **`AdminAuthorizerConstruct`** — the Cognito-backed request authorizer.

It exposes `getRestApiId()`, `getRootResourceId()`, and `getAuthorizer()` for use by the root stack when constructing the domain (spoke) nested stacks.

### Domain (spoke) nested stacks

Each domain nested stack receives the API Gateway's `restApiId` and `rootResourceId` as plain string props. Inside the nested stack, the API is reconstructed as a local CDK object using:

```javascript
const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedAdminApi', {
  restApiId: props.restApiId,
  rootResourceId: props.rootResourceId,
});
```

This avoids CDK cross-stack object references (which themselves consume root stack resources) while still allowing each nested stack to attach routes to the shared API.

## Deployment and Redeployment

Because the `RestApi` is created with `deploy: false`, API Gateway will not automatically create a deployment when routes change in nested stacks. The root stack handles this explicitly:

1. A `apigw.Deployment` resource is created with a timestamp-based logical ID (`Deployment-<ISO timestamp>`) to force CloudFormation to create a new deployment on every synthesis.
2. The deployment declares `node.addDependency(nestedStack)` for every domain nested stack, ensuring CloudFormation waits for all routes to be provisioned before deploying.
3. An `apigw.Stage` is then attached to that deployment with the configured `adminApiStageName`.

## Local vs. AWS Deployment

SAM (used for local development) does not support nested stacks. When the CDK context `@context` is set to `"local"`, domain constructs are instantiated directly in the root stack instead of being wrapped in nested stacks. The `api` prop is passed as a live CDK object reference in that case.

| Context | Constructs used |
|---|---|
| `local` | Flat `*Construct` classes directly in `AdminApiStack` |
| AWS (default) | `*NestedStack` wrappers per domain area |

## Feature Flags

Each domain area can be disabled at synth/deploy time via environment variable. All flags default to enabled.

| Environment Variable | Domain |
|---|---|
| `ENABLE_PING` | Ping / health-check |
| `ENABLE_BCSC` | BC Services Card login |
| `ENABLE_CONFIG` | Admin config getters |
| `ENABLE_SEARCH` | OpenSearch-backed search |
| `ENABLE_GEOZONES` | Geozone management |
| `ENABLE_FACILITIES` | Facility management |
| `ENABLE_ACTIVITIES` | Activity management |
| `ENABLE_PRODUCTS` | Product management |
| `ENABLE_POLICIES` | Policy management |
| `ENABLE_REPORTS` | Reporting |
| `ENABLE_RELATIONSHIPS` | Entity relationship management |
| `ENABLE_FEATURE_FLAGS` | Feature flag management |
| `ENABLE_USERS` | User management |
| `ENABLE_BOOKINGS` | Booking management |
| `ENABLE_VERIFY` | QR code verification |
| `ENABLE_PRODUCT_MANAGEMENT` | Product dates and management |

Set any flag to `"false"` to omit that nested stack entirely from the synthesized template:

```bash
ENABLE_SEARCH=false ENABLE_REPORTS=false yarn deploy:dev
```

## Stack ID Suffixes

Each nested stack sets a `concreteStackId` suffix used when generating scoped resource IDs. These changed as part of the refactor:

| Nested Stack | Suffix |
|---|---|
| AdminActivitiesNestedStack | `-AdmACT` |
| AdminBookingsNestedStack | `-AdmBKG` |
| AdminFacilitiesNestedStack | `-AdmFA` |
| AdminGeozonesNestedStack | `-AdmGZ` |
| AdminBCSCNestedStack | `-AdmBCSC` |
| AdminConfigNestedStack | `-AdmCFG` |
| AdminFeatureFlagsNestedStack | `-AdmFF` |

> **Note:** If any external tooling, SSM paths, or CloudFormation stack names depend on the old suffixes (e.g., `-Bkgs`, `-FA`), those references will need to be updated.

## Configuration (SSM)

The stack reads its config from SSM at:

```
/reserveRecApi/{deploymentName}/adminApiStack/config
```

Key config values (with defaults):

| Key | Default | Description |
|---|---|---|
| `adminApiStageName` | `"api"` | API Gateway stage name |
| `logLevel` | `"info"` | Lambda log level |
| `corsPreflightMaxAgeSeconds` | `600` | CORS preflight cache duration |
| `inheritAdminUserPoolSettingsFromDeployment` | `"true"` | Pull Cognito pool IDs from deployment stack |
| `adminUserPoolId` | `""` | Cognito User Pool ID (if not inherited) |
| `adminUserPoolClientId` | `""` | Cognito App Client ID (if not inherited) |
| `opensearchReferenceDataIndexName` | `""` | OpenSearch index for reference data |
| `opensearchTransactionalDataIndexName` | `""` | OpenSearch index for transactional data |
| `opensearchUserIndexName` | `""` | OpenSearch index for users |
