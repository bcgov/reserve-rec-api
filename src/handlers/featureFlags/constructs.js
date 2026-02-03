const { LambdaConstruct } = require('../../../lib/helpers/base-lambda');
const apigw = require('aws-cdk-lib/aws-apigateway');

const defaults = {
  resources: {
    featureFlagsGetPublicFunction: {
      name: 'FeatureFlagsGetPublic',
    },
    featureFlagsGetAdminFunction: {
      name: 'FeatureFlagsGetAdmin',
    },
    featureFlagsPutFunction: {
      name: 'FeatureFlagsPUT',
    }
  }
};

class AdminFeatureFlagsConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    // Add /featureFlags resource
    this.featureFlagsResource = this.resolveApi().root.addResource('featureFlags');

    // GET /featureFlags (public - no auth required)
    this.featureFlagsGetPublicFunction = this.generateBasicLambdaFn(
      scope,
      'featureFlagsGetPublicFunction',
      'src/handlers/featureFlags/GET',
      'public.handler',
      {
        basicRead: true,
      }
    );

    this.featureFlagsResource.addMethod(
      'GET',
      new apigw.LambdaIntegration(this.featureFlagsGetPublicFunction),
      {
        authorizationType: apigw.AuthorizationType.NONE
      }
    );

    // PUT /featureFlags (admin - requires auth, superadmin check in handler)
    this.featureFlagsPutFunction = this.generateBasicLambdaFn(
      scope,
      'featureFlagsPutFunction',
      'src/handlers/featureFlags/PUT',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    this.featureFlagsResource.addMethod(
      'PUT',
      new apigw.LambdaIntegration(this.featureFlagsPutFunction),
      {
        authorizationType: apigw.AuthorizationType.CUSTOM,
        authorizer: this.resolveAuthorizer()
      }
    );

    // Grant permissions
    this.grantBasicRefDataTableRead(this.featureFlagsGetPublicFunction);
    this.grantBasicRefDataTableReadWrite(this.featureFlagsPutFunction);
    this.grantAuditTableWrite(this.featureFlagsPutFunction);
  }
}

class PublicFeatureFlagsConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    // Add /featureFlags resource
    this.featureFlagsResource = this.resolveApi().root.addResource('featureFlags');

    // GET /featureFlags (public - no auth required)
    this.featureFlagsGetPublicFunction = this.generateBasicLambdaFn(
      scope,
      'featureFlagsGetPublicFunction',
      'src/handlers/featureFlags/GET',
      'public.handler',
      {
        basicRead: true,
      }
    );

    this.featureFlagsResource.addMethod(
      'GET',
      new apigw.LambdaIntegration(this.featureFlagsGetPublicFunction),
      {
        authorizationType: apigw.AuthorizationType.NONE
      }
    );

    // Grant permissions
    this.grantBasicRefDataTableRead(this.featureFlagsGetPublicFunction);
  }
}

module.exports = {
  AdminFeatureFlagsConstruct,
  PublicFeatureFlagsConstruct
};
