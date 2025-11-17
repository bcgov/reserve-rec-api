const { Construct } = require('constructs');
const lambda = require('aws-cdk-lib/aws-lambda');
const { Duration } = require('aws-cdk-lib');

class InitOpenSearchConstruct extends Construct {
  constructor(scope, id, props) {
    const constructId = scope?.createScopedId(id) || 'InitOpenSearchConstruct';
    super(scope, constructId, props);

    this.initOpenSearchLambdaFunction = new lambda.Function(scope, id, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/opensearch-stack/init-opensearch'),
      layers: props?.layers || [],
      environment: props?.environment || {},
      description: `Initializes OpenSearch indices and index patterns.`,
      functionName: id,
      timeout: Duration.seconds(30),
      role: props?.role
    });
  }
}

module.exports = {
  InitOpenSearchConstruct,
};