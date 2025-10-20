# OpenSearch Cognito Authentication Setup

## Overview
This guide explains how to properly configure Cognito authentication for OpenSearch and OpenSearch Dashboards with fine-grained access control.

AWS is not able to map OpenSearch Dashboard roles directly using Cognito, CDK, or the domain's REST API endpoints under typical developer permissions. The Dashboards master user must login at least once before Cognito is enabled and use Dashboard roles to grant permissions to Cognito groups. Cognito cannot be enabled before this step because when Cognito is enabled the Dashboards login automatically redirects to a Cognito-hosted login, preventing the master user from logging in.

Generally speaking, it has been found that OpenSearch is far easier managed through the AWS web console over CDK. The OpenSearch definition in this CDK deployment should be used as an initial configuration; it is recommended that all future changes are managed through the AWS console.

## Prerequisites
- AWS CDK stack with OpenSearch domain
- Cognito User Pool configured
- Master user credentials for OpenSearch

## Setup Process

### Step 1: Initial Deployment
Deploy the stack with Cognito authentication **disabled**:

```javascript
// In your CDK stack
this.openSearchDomain = new opensearch.Domain(this, 'Domain', {
  // cognitoDashboardsAuth: {  // COMMENT OUT OR REMOVE
  //   identityPoolId: 'your-identity-pool-id',
  //   userPoolId: 'your-user-pool-id',
  //   role: dashboardsRole
  // },
  fineGrainedAccessControl: {
    masterUserName: masterUserName,
    masterUserPassword: masterUserPassword
  },
  // ... other configuration
});
```

### Step 2: Configure Role Mapping
1. Access OpenSearch Dashboards via the domain endpoint
2. Login with the master user credentials
3. Navigate to **Security** → **Roles**
4. Edit the `all_access` role
5. Go to **Mapped users** tab
6. Add the approprate Cognito groups (e.g., `AdminGroup`, `UserGroup`)

**IMPORTANT**: For users that need Dashboards access: EVERY one of their assumable roles MUST have some kind of Dashboards tenant access mapped to the role's ARN. Cognito's token-based role mapping allows convenient user grouping, but this clashes with Dashboard's role mapping. While Cognito 'merges' permssions for availab

### Step 3: Enable Cognito Authentication
Uncomment and configure `cognitoDashboardsAuth`:

```javascript
this.openSearchDomain = new opensearch.Domain(this, 'Domain', {
  cognitoDashboardsAuth: {
    identityPoolId: 'your-identity-pool-id',
    userPoolId: 'your-user-pool-id',
    role: dashboardsRole
  },
  // FGAC can remain
  fineGrainedAccessControl: {
    masterUserName: 'admin',
    masterUserPassword: SecretValue.unsafeUnwrap(masterUserPassword)
  },
  // ... other configuration
});
```

### Step 4: Redeploy
Deploy the stack again to enable Cognito authentication.

## Important Notes
- Role mapping must be done **before** enabling Cognito auth
- Users will authenticate via Cognito after the final deployment
- Master user access remains available for administrative tasks

## Helpful Links
- [OpenSearch Fine-Grained Access Control](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/fgac.html)
- [Cognito Authentication for OpenSearch](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/cognito-auth.html)
- [CDK OpenSearch Domain](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_opensearch.Domain.html)