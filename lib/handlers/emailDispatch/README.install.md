# Email Dispatch Handler Dependencies

## Installation

This handler requires Handlebars for template compilation. Dependencies must be installed before deployment.

### Local Development

```bash
cd lib/handlers/emailDispatch
npm install --production
```

### CI/CD Deployment

The GitHub Actions workflow automatically installs handler dependencies during deployment.

### Why handler-specific dependencies?

This handler uses `lambda.Code.fromAsset()` for deployment, which bundles only files from the handler directory. Handler-specific dependencies must be installed locally within the handler directory.

## Dependencies

- `handlebars`: ^4.7.8 - Template engine for rendering HTML and text emails
