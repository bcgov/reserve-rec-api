"use strict";

const fs = require("fs");
const path = require("path");

jest.mock("../../src/scripts/tools/bundling/yarnBundler", () => ({
  buildDist: jest.fn((entry, outputDir) => {
    require("fs").writeFileSync(require("path").join(outputDir, "index.js"), "");
    return true;
  }),
}));

const cdk = require("aws-cdk-lib");
const { Template } = require("aws-cdk-lib/assertions");
const { buildDist } = require("../../src/scripts/tools/bundling/yarnBundler");
const { BaseLayerConstruct, AwsUtilsLayerConstruct } = require("../../src/layers/constructs");

class TestStack extends cdk.Stack {
  createScopedId(id) { return `scoped-${id}`; }
  getAppName() { return "reserve-rec"; }
  getDeploymentName() { return "dev"; }
}

const LAYERS = path.resolve(__dirname, "../../src/layers");

describe.each([
  [BaseLayerConstruct, "BaseLayer", "base", "Base layer for Lambda functions in reserve-rec - dev environment"],
  [AwsUtilsLayerConstruct, "AwsUtilsLayer", "awsUtils", "AWS Utils layer for Lambda functions in reserve-rec - dev environment"],
])("%p", (Construct, id, dir, description) => {
  let outdir;
  let stack;
  let construct;
  beforeEach(() => {
    buildDist.mockClear();
    outdir = fs.mkdtempSync(path.join(require("os").tmpdir(), "layer-cdk-"));
    stack = new TestStack(new cdk.App({ outdir }), "Stack");
    construct = new Construct(stack, id, { environment: { LOG_LEVEL: "info" } });
  });
  afterEach(() => fs.rmSync(outdir, { recursive: true, force: true }));

  it("defines one destroyable Node 22 layer with its description", () => {
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Lambda::LayerVersion", 1);
    template.hasResource("AWS::Lambda::LayerVersion", {
      DeletionPolicy: "Delete",
      Properties: {
        CompatibleRuntimes: ["nodejs22.x"],
        Description: description,
        LicenseInfo: "Apache-2.0",
      },
    });
    expect(construct.node.id).toBe(`scoped-${id}`);
    expect(construct.getLayer()).toBeInstanceOf(cdk.aws_lambda.LayerVersion);
  });

  it("bundles its own directory locally into nodejs/ with the given environment", () => {
    expect(buildDist).toHaveBeenCalledTimes(1);
    const [entry, outputDir, props] = buildDist.mock.calls[0];
    expect(entry).toBe(path.join(LAYERS, dir));
    expect(typeof outputDir).toBe("string");
    expect(props).toEqual({ env: { LOG_LEVEL: "info" }, nodejsPath: "nodejs" });
  });
});
