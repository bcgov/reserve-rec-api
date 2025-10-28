# SAM Template Generator - Environment Configuration

This script generates SAM templates from CDK CloudFormation templates with customizable environment variables.

## Features

- **Command-line environment variable overrides**: Pass custom values directly via command line
- **Configuration file support**: Load environment variables from JSON config files
- **Priority system**: CLI args > Config file > Process environment > Defaults
- **Simplified layer references**: Converts complex SSM parameter references to clean layer names
- **Local environment filtering**: Only processes CDK templates with "-Local-" in the name

## Usage

### Basic Usage
```bash
node scripts/generate-sam-templates.js
```

### Environment Variable Overrides

#### Using key=value format:
```bash
node scripts/generate-sam-templates.js TABLE_NAME=my-custom-table AUDIT_TABLE_NAME=my-audit
```

#### Using --env prefix:
```bash
node scripts/generate-sam-templates.js --env.TABLE_NAME=my-table --env.LOG_LEVEL=info
```

#### Using config file:
```bash
node scripts/generate-sam-templates.js --config ./my-config.json
```

#### Combining methods (CLI overrides config):
```bash
node scripts/generate-sam-templates.js --config ./base-config.json TABLE_NAME=override-table
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TABLE_NAME` | Main DynamoDB table name | `reserve-rec-local` |
| `AUDIT_TABLE_NAME` | Audit table name | `Audit-local` |
| `PUBSUB_TABLE_NAME` | PubSub table name | `reserve-rec-pubsub-local` |
| `DYNAMODB_ENDPOINT_URL` | DynamoDB endpoint | `http://localhost:8000` |
| `AWS_REGION` | AWS region | `ca-central-1` |
| `LOG_LEVEL` | Logging level | `debug` |
| `NODE_ENV` | Node environment | `development` |
| `TZ` | Timezone | `America/Vancouver` |

## Config File Format

Create a JSON file with the following structure:

```json
{
  "environment": {
    "TABLE_NAME": "my-custom-table",
    "AUDIT_TABLE_NAME": "my-custom-audit",
    "LOG_LEVEL": "info",
    "DYNAMODB_ENDPOINT_URL": "http://localhost:8000"
  }
}
```

## Priority Order

The script applies environment variables in this priority order:

1. **CLI arguments** (highest priority)
2. **Config file values**
3. **Process environment variables** (only if not overridden by CLI)
4. **Default values** (lowest priority)

## Examples

### Development Environment
```bash
node scripts/generate-sam-templates.js \
  TABLE_NAME=reserve-rec-dev \
  AUDIT_TABLE_NAME=audit-dev \
  LOG_LEVEL=debug
```

### Testing Environment
```bash
node scripts/generate-sam-templates.js --config ./test-config.json
```

### Quick Table Override
```bash
node scripts/generate-sam-templates.js --env.TABLE_NAME=my-test-table
```

## Output

The script generates SAM templates in the `cdk.out/` directory with names like:
- `sam-ReserveRecApi-Local-AdminApiStack-AdminApi.yaml`

These templates use simplified layer references and include all your custom environment variables.