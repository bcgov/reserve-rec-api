"use strict";

jest.mock("aws-cdk-lib/aws-lambda-nodejs", () => require("../helpers/cdkConstruct").nodejsFunctionMock());

const { synthConstruct, authByRoute } = require("../helpers/cdkConstruct");
const { PublicInventoryPoolsConstruct, InventoryPoolsConstruct } = require("../../src/handlers/inventoryPools/constructs");

describe("inventory-pools API wiring", () => {
  it("puts every admin route behind the custom authorizer", () => {
    const pools = "/inventory-pools/{collectionId}/{activityType}/{activityId}/{productId}";

    expect(authByRoute(synthConstruct(InventoryPoolsConstruct).routes)).toEqual({
      [`DELETE ${pools}`]: "CUSTOM",
      [`GET ${pools}`]: "CUSTOM",
      [`POST ${pools}`]: "CUSTOM",
      [`PUT ${pools}`]: "CUSTOM",
    });
  });

  it("gives the public API one authorized read with no write access to the table", () => {
    const { routes, grants } = synthConstruct(PublicInventoryPoolsConstruct);

    expect(authByRoute(routes)).toEqual({ "GET /inventoryPools/{collectionId}/{activityType}/{activityId}/{productId}": "CUSTOM" });
    const [actions] = Object.values(grants);
    expect(actions).toContain("dynamodb:Query");
    expect(actions).not.toEqual(expect.arrayContaining(["dynamodb:PutItem"]));
    expect(actions).not.toEqual(expect.arrayContaining(["dynamodb:DeleteItem"]));
  });
});
