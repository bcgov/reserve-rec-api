"use strict";

const { excludeDeletedItems, excludeHiddenItems } = require("/opt/dynamodb");

describe("excludeHiddenItems after excludeDeletedItems", () => {
  it("does not wrap the expression in redundant parentheses", () => {
    const q = excludeHiddenItems(excludeDeletedItems({}));
    expect(q.FilterExpression).toBe(
      "(attribute_not_exists(#isDeleted) OR #isDeleted = :notDeleted) AND (attribute_not_exists(#isVisible) OR #isVisible = :visible)"
    );
  });

  it("keeps an earlier filter grouped", () => {
    const q = excludeHiddenItems(excludeDeletedItems({ FilterExpression: "#a = :a", ExpressionAttributeValues: {} }));
    expect(q.FilterExpression).toBe(
      "(#a = :a) AND (attribute_not_exists(#isDeleted) OR #isDeleted = :notDeleted) AND (attribute_not_exists(#isVisible) OR #isVisible = :visible)"
    );
  });
});
