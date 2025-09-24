function getEnvelopeFromMultiPolygon(poly) {
  // poly may be Polygon or MultiPolygon
  let coords = poly.coordinates;
  if (poly.type === 'Polygon') {
    coords = [coords];
  }
  coords = coords.reduce((acc, p) => acc.concat(p), []);
  const minLng = Math.min(...coords[0].map(c => c[0]));
  const minLat = Math.min(...coords[0].map(c => c[1]));
  const maxLng = Math.max(...coords[0].map(c => c[0]));
  const maxLat = Math.max(...coords[0].map(c => c[1]));

  // format is [[minLng, maxLat], [maxLng, minLat]]
  let envelope = {
    type: 'envelope',
    coordinates: [[minLng, maxLat], [maxLng, minLat]]
  };
  return envelope;
}

function getCentroidFromEnvelope(envelope) {
  const midLng = (envelope.coordinates[0][0] + envelope.coordinates[1][0]) / 2;
  const midLat = (envelope.coordinates[0][1] + envelope.coordinates[1][1]) / 2;
  return {
    type: 'point',
    coordinates: [midLng, midLat]
  };
}

module.exports = {
  getCentroidFromEnvelope,
  getEnvelopeFromMultiPolygon,
};