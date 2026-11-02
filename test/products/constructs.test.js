"use strict";

jest.mock("aws-cdk-lib/aws-lambda-nodejs", () => require("../helpers/cdkConstruct").nodejsFunctionMock());

const { synthConstruct, authByRoute } = require("../helpers/cdkConstruct");
const { PublicProductsConstruct, AdminProductsConstruct } = require("../../src/handlers/products/constructs");

const PRODUCT = "/products/{collectionId}/{activityType}/{activityId}";
const HANDLERS = "src/handlers/products/_collectionId";

describe("products API wiring", () => {
  it("serves product reads to the public without an authorizer", () => {
    expect(authByRoute(synthConstruct(PublicProductsConstruct, { authorizer: undefined }).routes)).toEqual({
      "GET /products/{collectionId}": "NONE",
      [`GET ${PRODUCT}`]: "NONE",
    });
  });

  it("puts every admin route behind the custom authorizer", () => {
    expect(authByRoute(synthConstruct(AdminProductsConstruct).routes)).toEqual({
      [`DELETE ${PRODUCT}/{productId}`]: "CUSTOM",
      "GET /products/{collectionId}": "CUSTOM",
      [`GET ${PRODUCT}`]: "CUSTOM",
      "POST /products/{collectionId}": "CUSTOM",
      "PUT /products/{collectionId}": "CUSTOM",
      [`PUT ${PRODUCT}/{productId}`]: "CUSTOM",
    });
  });

  it("lets the admin write functions modify the reference table", () => {
    const { grants } = synthConstruct(AdminProductsConstruct);

    expect(grants[`${HANDLERS}/POST/admin.js`]).toEqual(expect.arrayContaining(["dynamodb:PutItem", "dynamodb:UpdateItem"]));
    expect(grants[`${HANDLERS}/DELETE/admin.js`]).toEqual(expect.arrayContaining(["dynamodb:UpdateItem", "dynamodb:Query"]));
  });
});
