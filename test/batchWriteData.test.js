const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/client-dynamodb'),
  DynamoDBClient: jest.fn(() => ({ send: (...args) => mockSend(...args) })),
}));

const { batchWriteData } = require('/opt/dynamodb');

const item = (n) => ({ pk: { S: `p${n}` }, sk: { S: 's' } });

describe('batchWriteData', () => {
  beforeEach(() => mockSend.mockReset());

  it('resolves when every item is processed', async () => {
    mockSend.mockResolvedValue({ UnprocessedItems: {} });
    await expect(batchWriteData([item(1), item(2)], 25, 'table')).resolves.toBeUndefined();
  });

  it('resends only the unprocessed items of a chunk and resolves when they succeed', async () => {
    jest.useFakeTimers();
    const throttled = { PutRequest: { Item: item(2) } };
    mockSend
      .mockResolvedValueOnce({ UnprocessedItems: {} })
      .mockResolvedValueOnce({ UnprocessedItems: { table: [throttled] } })
      .mockResolvedValueOnce({ UnprocessedItems: {} });

    const done = batchWriteData([item(1), item(2)], 1, 'table');
    await jest.runAllTimersAsync();
    await expect(done).resolves.toBeUndefined();

    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend.mock.calls[2][0].input.RequestItems).toEqual({ table: [throttled] });
    jest.useRealTimers();
  });

  it('throws when items are still unprocessed after the last resend', async () => {
    jest.useFakeTimers();
    mockSend.mockResolvedValue({ UnprocessedItems: { table: [{ PutRequest: { Item: item(2) } }] } });

    const done = batchWriteData([item(1), item(2)], 25, 'table');
    const assertion = expect(done).rejects.toThrow(/unprocessed/);
    await jest.runAllTimersAsync();
    await assertion;

    expect(mockSend).toHaveBeenCalledTimes(4);
    jest.useRealTimers();
  });
});
