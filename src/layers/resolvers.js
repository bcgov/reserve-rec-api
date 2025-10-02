const { Fn } = require("aws-cdk-lib");
const { exportNamer } = require("../../lib/utils");

function resolveBaseLayer(props) {
  const layerName = props?.CONSTANTS?.STACKS?.CORE_STACK?.BASE_LAYER_NAME;
  if (!layerName) {
    throw new Error("Base layer name not found in context.");
  }
  const layerImportName = exportNamer(layerName, {
    pathSuffix: 'layerVersionArn',
    ...props
  });
  return Fn.importValue(layerImportName);
}

module.exports = {
  resolveBaseLayer,
};