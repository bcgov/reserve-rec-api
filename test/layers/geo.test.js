"use strict";

const { getCentroidFromEnvelope, getEnvelopeFromMultiPolygon } = require("../../src/layers/base/geo");

describe("getEnvelopeFromMultiPolygon", () => {
  it("bounds a polygon's outer ring as [[minLng, maxLat], [maxLng, minLat]]", () => {
    const polygon = {
      type: "Polygon",
      coordinates: [[[-123.5, 48.4], [-123.1, 48.4], [-123.1, 48.9], [-123.5, 48.9], [-123.5, 48.4]]],
    };

    expect(getEnvelopeFromMultiPolygon(polygon)).toEqual({
      type: "envelope",
      coordinates: [[-123.5, 48.9], [-123.1, 48.4]],
    });
  });
});

describe("getCentroidFromEnvelope", () => {
  it("returns the midpoint of the envelope", () => {
    expect(getCentroidFromEnvelope({ type: "envelope", coordinates: [[-124, 49], [-122, 48]] })).toEqual({
      type: "point",
      coordinates: [-123, 48.5],
    });
  });
});
