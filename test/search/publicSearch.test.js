'use strict';

const opensearch = require('/opt/opensearch');
const { handler } = require('../../src/handlers/search/POST/admin');

const hit = (id, source, score = 1) => ({ _id: id, _score: score, _source: source });
const respondWith = (hits) => jest.spyOn(opensearch.client, 'search').mockResolvedValue({ body: { hits: { total: { value: hits.length }, hits } } });
const post = (body) => ({ httpMethod: 'POST', body: JSON.stringify(body), headers: {} });
const sentBody = () => opensearch.client.search.mock.calls[0][0].body;

const visible = hit('a', { displayName: 'Golden Ears', adminNotes: 'secret', isVisible: true }, 5);
const hidden = hit('b', { displayName: 'Draft Park', isVisible: false }, 4);
const noFlag = hit('c', { displayName: 'Garibaldi' }, 3);

describe('POST /search (public)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('answers CORS preflight', async () => {
    const res = await handler({ httpMethod: 'OPTIONS' }, {});
    expect(res.statusCode).toBe(200);
  });

  it('drops hidden documents and strips adminNotes from search hits', async () => {
    respondWith([visible, hidden, noFlag]);
    const res = await handler(post({ text: 'park' }), {});
    const data = JSON.parse(res.body).data;
    expect(res.statusCode).toBe(200);
    expect(data.hits.map((h) => h._id)).toEqual(['a', 'c']);
    expect(data.hits[0]._source).toEqual({ displayName: 'Golden Ears', isVisible: true });
  });

  it('uses a query_string match by default and a fuzzy match when asked', async () => {
    respondWith([]);
    await handler(post({ text: 'golden' }), {});
    expect(JSON.stringify(sentBody().query)).toContain('"query_string"');
    expect(JSON.stringify(sentBody().query)).not.toContain('"fuzziness"');

    jest.restoreAllMocks();
    respondWith([]);
    await handler(post({ text: 'goldn', fuzzy: true, fuzziness: 2 }), {});
    const q = JSON.stringify(sentBody().query);
    expect(q).toContain('"searchTerms"');
    expect(q).toContain('"fuzziness":2');
    expect(q).not.toContain('"query_string"');
  });

  it('turns keyable body fields into term filters and ignores control fields', async () => {
    respondWith([]);
    await handler(post({ schema: 'collection', size: 5, sortOrder: 'desc' }), {});
    const q = JSON.stringify(sentBody().query);
    expect(q).toContain('"schema"');
    expect(q).toContain('collection');
    expect(q).not.toContain('sortOrder');
    expect(opensearch.client.search.mock.calls[0][0].size).toBe(5);
  });

  it('returns sanitized suggestions with display text and score', async () => {
    respondWith([visible, hidden]);
    const res = await handler(post({ suggest: true, text: 'gold' }), {});
    expect(JSON.parse(res.body).data).toEqual([
      { text: 'Golden Ears', score: 5, _source: { displayName: 'Golden Ears', isVisible: true } },
    ]);
  });

  it('builds one prefix and one fuzzy clause per word with descending boosts', async () => {
    respondWith([]);
    await handler(post({ suggest: true, text: 'golden ears park lake', suggestField: 'name.suggest', filters: { schema: 'collection' } }), {});
    const { bool } = sentBody().query;
    const prefixBoosts = bool.should.filter((c) => c.match_phrase_prefix).map((c) => c.match_phrase_prefix.name.boost);
    const fuzzyBoosts = bool.should.filter((c) => c.match).map((c) => c.match.name.boost);
    expect(prefixBoosts).toEqual([3, 2, 1.5, 1]);
    expect(fuzzyBoosts).toEqual([1.5, 1, 0.75, 0.5]);
    expect(bool.minimum_should_match).toBe(1);
    expect(JSON.stringify(bool)).toContain('collection');
  });

  it('a single-word suggestion gets a boosted prefix and a fuzzy clause on searchTerms', async () => {
    respondWith([]);
    await handler(post({ suggest: true, text: 'gold', suggestSize: 3 }), {});
    const { bool } = sentBody().query;
    expect(bool.should).toEqual([
      { match_phrase_prefix: { searchTerms: { query: 'gold', max_expansions: 50, boost: 3 } } },
      { match: { searchTerms: { query: 'gold', fuzziness: 'AUTO', prefix_length: 1, max_expansions: 50, boost: 1 } } },
    ]);
    expect(opensearch.client.search.mock.calls[0][0].size).toBe(3);
  });

  it('returns 400 when OpenSearch fails', async () => {
    jest.spyOn(opensearch.client, 'search').mockRejectedValue(new Error('cluster down'));
    const res = await handler(post({ text: 'x' }), {});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).data).toEqual([]);
  });
});
