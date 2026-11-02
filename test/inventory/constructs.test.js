"use strict";

jest.mock("aws-cdk-lib/aws-lambda-nodejs", () => require("../helpers/cdkConstruct").nodejsFunctionMock());

const { synthConstruct, authByRoute } = require("../helpers/cdkConstruct");
const { InventoryConstruct } = require("../../src/handlers/inventory/constructs");

describe("inventory API wiring", () => {
  it("puts every route behind the custom authorizer", () => {
    const inventory = "/inventory/{collectionId}/{activityType}/{activityId}/{productId}";

    expect(authByRoute(synthConstruct(InventoryConstruct).routes)).toEqual({
      [`DELETE ${inventory}`]: "CUSTOM",
      [`GET ${inventory}`]: "CUSTOM",
      [`POST ${inventory}`]: "CUSTOM",
    });
  });
});
