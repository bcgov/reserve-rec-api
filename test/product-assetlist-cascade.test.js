const mockRunQuery = jest.fn();
const mockBatchTransactData = jest.fn();

jest.mock('/opt/dynamodb', () => ({
  REFERENCE_DATA_TABLE_NAME: 'test-table',
  runQuery: (...args) => mockRunQuery(...args),
  batchTransactData: (...args) => mockBatchTransactData(...args),
  marshall: (item) => item,
  getOne: jest.fn(),
}));

const { syncAssetListToProductDates } = require('../src/handlers/productDates/methods');
const { syncCapacityToInventoryPools } = require('../src/handlers/inventoryPools/methods');

const asset = { primaryKey: { pk: 'asset::col::park', sk: '1' }, allocationType: 'pool' };
const assetSk = 'asset::col::park::1';
const productKeys = { collectionId: 'col', activityType: 'dayuse', activityId: 1, productId: 1 };

beforeEach(() => {
  mockRunQuery.mockReset();
  mockBatchTransactData.mockReset();
  mockBatchTransactData.mockResolvedValue(true);
});

describe('syncAssetListToProductDates', () => {
  it('writes the new quantity to future ProductDates and skips manual overrides', async () => {
    mockRunQuery.mockResolvedValue({
      items: [
        { pk: 'productDate::col::dayuse::1::1', sk: '2026-09-01', assetList: [{ ...asset, quantity: 10 }] },
        { pk: 'productDate::col::dayuse::1::1', sk: '2026-09-02', assetList: [{ ...asset, quantity: 3 }], assetListManuallyEdited: true },
      ],
    });

    const updated = await syncAssetListToProductDates({ ...productKeys, assetList: [{ ...asset, quantity: 25 }] });

    expect(updated).toEqual(['2026-09-01']);
    const written = mockBatchTransactData.mock.calls[0][0];
    expect(written).toHaveLength(1);
    expect(written[0].Item.sk).toBe('2026-09-01');
    expect(written[0].Item.assetList[0].quantity).toBe(25);
    // asset identity is preserved
    expect(written[0].Item.assetList[0].primaryKey).toEqual(asset.primaryKey);
  });

  it('only queries dates from today forward', async () => {
    mockRunQuery.mockResolvedValue({ items: [] });

    await syncAssetListToProductDates({ ...productKeys, assetList: [{ ...asset, quantity: 5 }] });

    const startDate = mockRunQuery.mock.calls[0][0].ExpressionAttributeValues[':startDate'].S;
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(startDate >= '2026-01-01').toBe(true);
    expect(mockBatchTransactData).not.toHaveBeenCalled();
  });

  it('does nothing when there is no assetList', async () => {
    expect(await syncAssetListToProductDates({ ...productKeys, assetList: [] })).toEqual([]);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});

describe('syncCapacityToInventoryPools', () => {
  it('keeps already-taken units taken when capacity grows', async () => {
    // 10 capacity, 6 available => 4 taken
    mockRunQuery.mockResolvedValue({ items: [{ pk: 'inventoryPool::col::dayuse::1::1::2026-09-01', sk: assetSk, capacity: 10, availability: 6 }] });

    const count = await syncCapacityToInventoryPools({ ...productKeys, dates: ['2026-09-01'], assetList: [{ ...asset, quantity: 25 }] });

    expect(count).toBe(1);
    const written = mockBatchTransactData.mock.calls[0][0][0].Item;
    expect(written.capacity).toBe(25);
    expect(written.availability).toBe(21);
  });

  it('floors availability at zero when the new capacity is below what is taken', async () => {
    mockRunQuery.mockResolvedValue({ items: [{ pk: 'inventoryPool::col::dayuse::1::1::2026-09-01', sk: assetSk, capacity: 10, availability: 2 }] });

    await syncCapacityToInventoryPools({ ...productKeys, dates: ['2026-09-01'], assetList: [{ ...asset, quantity: 5 }] });

    const written = mockBatchTransactData.mock.calls[0][0][0].Item;
    expect(written.capacity).toBe(5);
    expect(written.availability).toBe(0);
  });

  it('ignores pools for assets that are not in the new assetList', async () => {
    mockRunQuery.mockResolvedValue({ items: [{ pk: 'inventoryPool::col::dayuse::1::1::2026-09-01', sk: 'asset::col::other::9', capacity: 10, availability: 10 }] });

    expect(await syncCapacityToInventoryPools({ ...productKeys, dates: ['2026-09-01'], assetList: [{ ...asset, quantity: 5 }] })).toBe(0);
    expect(mockBatchTransactData).not.toHaveBeenCalled();
  });
});
