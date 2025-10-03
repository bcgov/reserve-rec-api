const { Fn } = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const { exportNamer } = require("../../lib/utils");
const crypto = require("crypto");

function resolveBaseLayer(scope, props) {
  const layerName = props?.CONSTANTS?.STACKS?.CORE_STACK?.BASE_LAYER_NAME;
  let layer = null;
  if (!layerName) {
    throw new Error("Base layer name not found in context.");
  }
  const layerImportName = exportNamer(layerName, {
    ...props,
    isCfnOutput: true,
    pathSuffix: 'layerVersionArn',
    STACK_NAME: props?.CONSTANTS?.STACKS?.CORE_STACK?.STACK_NAME,
  });
  const hash = crypto.randomBytes(4).toString('hex');
  const uniqueImportName = `${layerName}-Import-${hash}`;
  const layerVersionArn = Fn.importValue(layerImportName);
  if (!layerVersionArn) {
    throw new Error(`Base layer ARN not found for import: ${layerImportName}`);
  }
  layer = lambda.LayerVersion.fromLayerVersionArn(scope, uniqueImportName, layerVersionArn);
  return layer;
}

module.exports = {
  resolveBaseLayer,
};