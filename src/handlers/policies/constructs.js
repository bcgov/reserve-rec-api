const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    policiesGetFunction: {
      name: 'PoliciesGET',
    },
    policiesPostFunction: {
      name: 'PoliciesPOST',
    },
    policiesPutFunction: {
      name: 'PoliciesPUT',
    },
    policiesDeleteFunction: {
      name: 'PoliciesDELETE',
    },
  }
};

class PoliciesConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'public';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /policies resource
    this.policiesResource = this.resolveApi().root.addResource('policies');

    // Add /policies/{policyType} resource
    this.policiesTypeResource = this.policiesResource.addResource('{policyType}');

    // Add /policies/{policyType}/{policyId} resource
    this.policiesPolicyTypeIdResource = this.policiesTypeResource.addResource('{policyId}');

    // Add /policies/{policyType}/{policyId}/{policyIdVersion} resource
    this.policiesPolicyTypeIdVersionResource = this.policiesPolicyTypeIdResource.addResource('{policyIdVersion}');

    // Policies GET Lambda Function
    this.policiesGetFunction = this.generateBasicLambdaFn(
      scope,
      'policiesGetFunction',
      'src/handlers/policies/GET',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // GET /policies/{policyType}/{policyId}
    this.policiesPolicyTypeIdResource.addMethod('GET', new apigw.LambdaIntegration(this.policiesGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /policies/{policyType}/{policyId}/{policyIdVersion}
    this.policiesPolicyTypeIdVersionResource.addMethod('GET', new apigw.LambdaIntegration(this.policiesGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Policies Booking POST Lambda Function
    this.policiesPostFunction = this.generateBasicLambdaFn(
      scope,
      'policiesPostFunction',
      'src/handlers/policies/POST',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // POST /policies/{policyType}
    this.policiesTypeResource.addMethod('POST', new apigw.LambdaIntegration(this.policiesPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Policies Booking PUT Lambda Function
    this.policiesPutFunction = this.generateBasicLambdaFn(
      scope,
      'policiesPutFunction',
      'src/handlers/policies/PUT',
      handlerName,
      {
        basicReadWrite: true,
      }
    );


    // PUT /policies/{policyType}/{policyId}
    this.policiesPolicyTypeIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.policiesPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Policies DELETE Lambda Function
    this.policiesDeleteFunction = this.generateBasicLambdaFn(
      scope,
      'policiesDeleteFunction',
      'src/handlers/policies/DELETE',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // DELETE /policies/{policyType}/{policyId}
    this.policiesPolicyTypeIdResource.addMethod('DELETE', new apigw.LambdaIntegration(this.policiesDeleteFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // DELETE /policies/{policyType}/{policyId}/{policyIdVersion}
    this.policiesPolicyTypeIdVersionResource.addMethod('DELETE', new apigw.LambdaIntegration(this.policiesDeleteFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

  }
}

module.exports = {
  PoliciesConstruct,
};