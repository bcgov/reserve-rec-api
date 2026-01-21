const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");
const { Duration } = require("aws-cdk-lib");

const defaults = {
  resources: {
    dailyPassesGETFunction: {
      name: 'DailyPassesGET',
    },
  },
};

class ReportsConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, { ...props, defaults });

    // /reports resource
    this.reportsResource = this.resolveApi().root.addResource('reports');

    // /reports/daily-passes resource
    this.dailyPassesResource = this.reportsResource.addResource('daily-passes');

    // GET /reports/daily-passes Lambda (30s timeout for larger datasets)
    this.dailyPassesGETFunction = this.generateBasicLambdaFn(
      scope,
      'dailyPassesGETFunction',
      'src/handlers/reports/GET',
      'admin.handler',
      {
        transDataBasicRead: true,
        timeout: Duration.seconds(30)
      }
    );

    // Wire to API with authorization
    this.dailyPassesResource.addMethod('GET',
      new apigw.LambdaIntegration(this.dailyPassesGETFunction), {
        authorizationType: apigw.AuthorizationType.CUSTOM,
        authorizer: this.resolveAuthorizer(),
      }
    );

    // Grant permissions (both transactional + reference data)
    this.grantBasicTransDataTableRead(this.dailyPassesGETFunction);
    this.grantBasicRefDataTableRead(this.dailyPassesGETFunction);
  }
}

module.exports = { ReportsConstruct };
