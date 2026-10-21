const mockSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/client-dynamodb'),
  DynamoDBClient: jest.fn(() => ({ send: (...args) => mockSend(...args) })),
}));

const { UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { updateItem } = require('/opt/dynamodb');

describe('updateItem', () => {
  beforeEach(() => mockSend.mockClear());

  it('sets only the attributes it is given on an existing item', async () => {
    await updateItem({ pk: 'user', sk: 'sub-1', status: 'x', lastLogin: 't' }, 'table');

    const [[command]] = mockSend.mock.calls;
    expect(command).toBeInstanceOf(UpdateItemCommand);
    expect(command.input).toEqual({
      TableName: 'table',
      Key: { pk: { S: 'user' }, sk: { S: 'sub-1' } },
      UpdateExpression: 'SET #f0 = :f0, #f1 = :f1',
      ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
      ExpressionAttributeNames: { '#f0': 'status', '#f1': 'lastLogin' },
      ExpressionAttributeValues: { ':f0': { S: 'x' }, ':f1': { S: 't' } },
    });
  });

  it('throws without sending when given only the key', async () => {
    await expect(updateItem({ pk: 'user', sk: 'sub-1' }, 'table')).rejects.toThrow(/at least one attribute/);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
