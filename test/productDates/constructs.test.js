"use strict";

jest.mock("aws-cdk-lib/aws-lambda-nodejs", () => require("../helpers/cdkConstruct").nodejsFunctionMock());

const { synthConstruct, authByRoute } = require("../helpers/cdkConstruct");
const { ProductDatesConstruct, PublicProductDatesConstruct } = require("../../src/handlers/productDates/constructs");

const PRODUCT = "/product-dates/{collectionId}/{activityType}/{activityId}/{productId}";

describe("product-dates API wiring", () => {
  it("puts every admin route behind the custom authorizer", () => {
    expect(authByRoute(synthConstruct(ProductDatesConstruct).routes)).toEqual({
      [`DELETE ${PRODUCT}`]: "CUSTOM",
      [`GET ${PRODUCT}`]: "CUSTOM",
      [`POST ${PRODUCT}`]: "CUSTOM",
      [`PUT ${PRODUCT}/{date}`]: "CUSTOM",
    });
  });

  it("exposes only a read on the public API, still through the authorizer", () => {
    expect(authByRoute(synthConstruct(PublicProductDatesConstruct).routes)).toEqual({ [`GET ${PRODUCT}`]: "CUSTOM" });
  });
});
