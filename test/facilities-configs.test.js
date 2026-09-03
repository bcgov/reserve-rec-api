jest.mock('/opt/dynamodb', () => ({
  REFERENCE_DATA_TABLE_NAME: 'test-table',
  marshall: (item) => item,
}));

const { quickApiUpdateHandler } = require('../src/common/data-utils');
const { FACILITY_API_UPDATE_CONFIG } = require('../src/handlers/facilities/configs');

const baseItem = {
  key: { pk: 'facility::col::campground', sk: '1' },
  data: {},
};

describe('FACILITY_API_UPDATE_CONFIG closure fields', () => {
  it('accepts closureStatus and closureReason strings', async () => {
    const items = await quickApiUpdateHandler('test-table', [{
      ...baseItem,
      data: { closureStatus: 'Full closure', closureReason: 'Flooding' },
    }], FACILITY_API_UPDATE_CONFIG);

    const expr = items[0].data.UpdateExpression;
    expect(expr).toContain('closureStatus');
    expect(expr).toContain('closureReason');
  });

  it('rejects a non-string closureStatus', async () => {
    await expect(quickApiUpdateHandler('test-table', [{
      ...baseItem,
      data: { closureStatus: 123 },
    }], FACILITY_API_UPDATE_CONFIG)).rejects.toThrow();
  });
});
