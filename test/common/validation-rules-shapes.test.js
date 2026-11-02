'use strict';

const { rulesFns } = require('../../src/common/validation-rules');

const rf = new rulesFns();
const rejects400 = (fn) => expect(fn).toThrow(expect.objectContaining({ code: 400 }));

describe('expectGeopoint', () => {
  it('accepts a [lng, lat] point', () => {
    expect(() => rf.expectGeopoint({ type: 'point', coordinates: [-123.37, 48.42] })).not.toThrow();
  });

  it.each([
    ['wrong type', { type: 'Point', coordinates: [-123, 48] }],
    ['one coordinate', { type: 'point', coordinates: [-123] }],
    ['lat/lng swapped out of range', { type: 'point', coordinates: [48, -123] }],
    ['string coordinate', { type: 'point', coordinates: ['-123', 48] }],
  ])('rejects %s', (_label, value) => rejects400(() => rf.expectGeopoint(value)));
});

describe('expectEnvelope', () => {
  const env = (coordinates) => ({ type: 'envelope', coordinates });

  it('accepts [upper-left, lower-right] in BC', () => {
    expect(() => rf.expectEnvelope(env([[-123.5, 49.5], [-123.0, 49.0]]))).not.toThrow();
  });

  it.each([
    ['wrong type', { type: 'polygon', coordinates: [[-123.5, 49.5], [-123.0, 49.0]] }],
    ['no coordinates', { type: 'envelope' }],
    ['three points', env([[-123.5, 49.5], [-123.2, 49.2], [-123.0, 49.0]])],
    ['longitudes reversed', env([[-123.0, 49.5], [-123.5, 49.0]])],
    ['latitudes reversed', env([[-123.5, 49.0], [-123.0, 49.5]])],
    ['latitude out of range', env([[-123.5, 95], [-123.0, 49.0]])],
  ])('rejects %s', (_label, value) => rejects400(() => rf.expectEnvelope(value)));
});

describe('expectGeoshape', () => {
  it('accepts an envelope or polygon ring', () => {
    expect(() => rf.expectGeoshape({ type: 'polygon', coordinates: [[[-123, 49], [-122, 49], [-122, 48]]] })).not.toThrow();
    expect(() => rf.expectGeoshape({ type: 'envelope', coordinates: [[[-123, 49], [-122, 48]]] })).not.toThrow();
  });

  it.each([
    ['unknown type', { type: 'circle', coordinates: [[[-123, 49], [-122, 48]]] }],
    ['coordinates not an array', { type: 'polygon', coordinates: 'x' }],
    ['a single point', { type: 'polygon', coordinates: [[[-123, 49]]] }],
    ['a point out of range', { type: 'polygon', coordinates: [[[-123, 49], [-200, 48]]] }],
  ])('rejects %s', (_label, value) => rejects400(() => rf.expectGeoshape(value)));
});

describe('time and duration objects', () => {
  it('expect24hTimeObjFormat accepts hour/minute/second integers only', () => {
    expect(() => rf.expect24hTimeObjFormat({ hour: 7, minute: 30 })).not.toThrow();
    rejects400(() => rf.expect24hTimeObjFormat({}));
    rejects400(() => rf.expect24hTimeObjFormat({ hours: 7 }));
    rejects400(() => rf.expect24hTimeObjFormat({ hour: 7.5 }));
  });

  it('expectDurationObjFormat accepts Luxon duration keys with integer values', () => {
    expect(() => rf.expectDurationObjFormat({ days: 2, hours: 3 })).not.toThrow();
    rejects400(() => rf.expectDurationObjFormat({ fortnights: 1 }));
    rejects400(() => rf.expectDurationObjFormat({ days: -1 }));
  });

  it('expectTemporalDuration needs an object with at least one duration key', () => {
    expect(() => rf.expectTemporalDuration({ weeks: 1 })).not.toThrow();
    rejects400(() => rf.expectTemporalDuration(null));
    rejects400(() => rf.expectTemporalDuration({ direction: 'before' }));
    rejects400(() => rf.expectTemporalDuration(3));
  });
});

describe('date strings', () => {
  it('expectISODateTimeObjFormat accepts only the canonical toISOString form', () => {
    expect(() => rf.expectISODateTimeObjFormat('2026-10-30T12:00:00.000Z')).not.toThrow();
    rejects400(() => rf.expectISODateTimeObjFormat('2026-10-30T12:00:00Z'));
  });

  it('expectISODateObjFormat checks the given Luxon format', () => {
    expect(() => rf.expectISODateObjFormat('2026-10-30')).not.toThrow();
    expect(() => rf.expectISODateObjFormat('30/10/2026', 'dd/LL/yyyy')).not.toThrow();
    rejects400(() => rf.expectISODateObjFormat('2026-02-30'));
    rejects400(() => rf.expectISODateObjFormat('30/10/2026'));
  });
});

describe('primary keys', () => {
  it('expectPrimaryKey with allowEmpty lets empty values through but still checks real ones', () => {
    for (const empty of [null, undefined, '', {}]) {
      expect(() => rf.expectPrimaryKey(empty, true)).not.toThrow();
    }
    rejects400(() => rf.expectPrimaryKey({ pk: 'a' }, true));
  });

  it('expectPrimaryKeyArray checks every element', () => {
    expect(() => rf.expectPrimaryKeyArray([{ pk: 'a', sk: 'b' }, { pk: 'c', sk: 'd' }])).not.toThrow();
    rejects400(() => rf.expectPrimaryKeyArray([{ pk: 'a', sk: 'b' }, { pk: 'c' }]));
    rejects400(() => rf.expectPrimaryKeyArray({ pk: 'a', sk: 'b' }));
  });
});
