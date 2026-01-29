const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    relationshipsGetFunction: {
      name: 'RelationshipsGET',
    },
    relationshipsPostFunction: {
      name: 'RelationshipsPOST',
    },
    relationshipsDeleteFunction: {
      name: 'RelationshipsDELETE',
    },
    relationshipsReverseGetFunction: {
      name: 'RelationshipsReverseGET',
    }
  }
}

class RelationshipsConstruct extends LambdaConstruct {
  constructor(scope, id,  props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'admin';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /relationships resource
    this.relationshipsResource = this.resolveApi().root.addResource('relationships');

    // Add /relationships/{pk1} resource
    this.relationshipsPk1Resource = this.relationshipsResource.addResource('{pk1}');

    // Add /relationships/{pk1}/{sk1} resource
    this.relationshipsSk1Resource = this.relationshipsPk1Resource.addResource('{sk1}');

    // Add /relationships/{pk1}/{sk1}/{pk2} resource
    this.relationshipsPk2Resource = this.relationshipsSk1Resource.addResource('{pk2}');

    // Add /relationships/{pk1}/{sk1}/{pk2}/{sk2} resource
    this.relationshipsSk2Resource = this.relationshipsPk2Resource.addResource('{sk2}');

    // Add /relationships/reverse resource
    this.relationshipsReverseResource = this.relationshipsResource.addResource('reverse');

    // Add /relationships/reverse/{pk2} resource
    this.relationshipsReversePk2Resource = this.relationshipsReverseResource.addResource('{pk2}');

    // Add /relationships/reverse/{pk2}/{sk2} resource
    this.relationshipsReverseSk2Resource = this.relationshipsReversePk2Resource.addResource('{sk2}');

    // Relationships GET Lambda Function
    this.relationshipsGetFunction = this.generateBasicLambdaFn(
      scope,
      'relationshipsGetFunction',
      'src/handlers/relationships/_compoundPk1/_compoundSk1/GET',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // GET /relationships/{pk1}/{sk1}
    this.relationshipsSk1Resource.addMethod('GET', new apigw.LambdaIntegration(this.relationshipsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Relationships POST Lambda Function
    this.relationshipsPostFunction = this.generateBasicLambdaFn(
      scope,
      'relationshipsPostFunction',
      'src/handlers/relationships/POST',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // POST /relationships
    this.relationshipsResource.addMethod('POST', new apigw.LambdaIntegration(this.relationshipsPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Relationships DELETE Lambda Function
    this.relationshipsDeleteFunction = this.generateBasicLambdaFn(
      scope,
      'relationshipsDeleteFunction',
      'src/handlers/relationships/_compoundPk1/_compoundSk1/_compoundPk2/_compoundSk2/DELETE',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // DELETE /relationships/{pk1}/{sk1}/{pk2}/{sk2}
    this.relationshipsSk2Resource.addMethod('DELETE', new apigw.LambdaIntegration(this.relationshipsDeleteFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Relationships Reverse GET Lambda Function (optional separate endpoint)
    this.relationshipsReverseGetFunction = this.generateBasicLambdaFn(
      scope,
      'relationshipsReverseGetFunction',
      'src/handlers/relationships/reverse/_compoundPk2/_compoundSk2/GET',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // GET /relationships/reverse/{pk2}/{sk2}
    this.relationshipsReverseSk2Resource.addMethod('GET', new apigw.LambdaIntegration(this.relationshipsReverseGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add permissions to all functions
    const functions = [
      this.relationshipsGetFunction,
      this.relationshipsPostFunction,
      this.relationshipsDeleteFunction,
      this.relationshipsReverseGetFunction,
    ];

    for (const func of functions) {
      this.grantBasicRefDataTableReadWrite(func);
    }

  }
}

module.exports = {
  RelationshipsConstruct,
};
