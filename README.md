# Reserve Rec API

This project defines the infrastructure for a **serverless camping reservation system** using the [AWS Cloud Development Kit (CDK)](https://docs.aws.amazon.com/cdk/).

The system provides:

- **Public user experience**: browse camping inventory, search by inventory metadata, and make reservations.
- **Administrator experience**: manage inventory, users, and reservations through a secure admin portal.

---

## 📦 Project Structure

- `/bin` – CDK app entrypoint, instantiates stacks.
- `/lib` – CDK stack definitions:
  - [`admin-identity-stack.js`](https://admin-identity-stack.js) – Cognito identity management for administrators.
  - [`public-identity-stack.js`](https://public-identity-stack.js) – Cognito identity management for public users.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (>= 18.x)
- [AWS CDK](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) (v2)
- AWS account and credentials configured

### Install Dependencies

```bash
yarn
```

### Deployment Configuration

This project uses **CDK context variables** to manage deployment settings across environments. Context variables can be used analogously to environment variables (`process.env`) without having to merge your environment into your runtime containers.

- The root [`cdk.json`](https://cdk.json) contains **preliminary context values** grouped into deployment environments: `dev`, `staging`, `prod`, `local`.

  Each environment contains key-value pairs:

  - `env-name`: The name of the deployment environment (same as context value)
  - `AWS_REGION`: AWS deployment region
  - `IS_OFFLINE`: If `true`, CDK assumes local synth/deploy and avoids remote AWS operations

- Additional context groups can be added to `cdk.json` for personal or team-specific deployments.
- These values help locate a larger configuration JSON that defines environment-specific details (e.g., resource names, secrets) per stack.
- There are multiple levels of context with hierarchies that take precedence over one another. Context levels exist as JSON files that are merged using JS `Object.merge()` method. When synthing/deploying:
 1. Context in `cdk.json` has the highest precedence.
 2. [App context](#app-context) (`/bin/app-context.json`) is second highest.
 3. Stack Context (Imported from `ssm`, or `/lib/<stack>/<local-context.json>`) is third.
 4. Default Stack Context (`/lib/<stack>/default-context.json`) is lowest.

### App Context

App-wide context is stored in `/bin/app-context.json`. These values typically should not change across stacks or environments and typically should not be changed once your app is deployed.

- `APP_NAME`: The name of the app (`ReserveRecApi`)
- `LOCAL_CONTEXT_PATH`: Path to a local JSON config for wiring up local services. Each stac

- During **local development**, this config is expected at `/lib/local-context.json`
- In **remote environments** (e.g., CI/CD), config is retrieved from **AWS SSM Parameter Store** and **AWS Secrets Manager**