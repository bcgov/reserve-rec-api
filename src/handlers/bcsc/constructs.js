const lambda = require('aws-cdk-lib/aws-lambda');
const { Duration } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { Construct } = require('constructs');
const path = require('path');

class BCSCConstruct extends Construct {
  constructor(scope, id, props) {
    super(scope, id);

    const {
      environment = {},
      layers = [],
      api,
    } = props;

    if (!api) {
      throw new Error('BCSCConstruct: Missing required property "api" in props');
    }

    // BCSC GET Handler
    this.bcscGetHandler = new lambda.Function(this, 'BCSCGetHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'GET')),
      layers: layers,
      environment: {
        ...environment,
        LOG_LEVEL: environment.LOG_LEVEL || 'info',
      },
      timeout: Duration.seconds(30),
      memorySize: 256,
      functionName: `${scope.stackName}-BCSCGetHandler`,
    });

    // BCSC POST Handler
    this.bcscPostHandler = new lambda.Function(this, 'BCSCPostHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'POST')),
      layers: layers,
      environment: {
        ...environment,
        LOG_LEVEL: environment.LOG_LEVEL || 'info',
      },
      timeout: Duration.seconds(30),
      memorySize: 256,
      functionName: `${scope.stackName}-BCSCPostHandler`,
    });

    // Create /bcsc resource
    const bcscResource = api.root.addResource('bcsc');

    // GET /bcsc/jwks - Public key endpoint
    const jwksResource = bcscResource.addResource('jwks');
    jwksResource.addMethod('GET', new apigw.LambdaIntegration(this.bcscGetHandler));

    // /bcsc/userinfo/{env}
    const userinfoResource = bcscResource.addResource('userinfo');
    const envResource = userinfoResource.addResource('{env}');
    
    // GET /bcsc/userinfo/{env}
    envResource.addMethod('GET', new apigw.LambdaIntegration(this.bcscGetHandler));

    // POST /bcsc/userinfo/{env}
    envResource.addMethod('POST', new apigw.LambdaIntegration(this.bcscPostHandler));
  }
}

module.exports = {
  BCSCConstruct,
};