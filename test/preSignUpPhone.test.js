const mockLoggerInfo = jest.fn();

jest.mock('/opt/base', () => ({
  requestIdentity: jest.fn(() => ({})),
  logger: { debug: jest.fn(), info: mockLoggerInfo, error: jest.fn() },
}));
jest.mock('/opt/emailBlocklist', () => ({
  loadBlocklist: jest.fn().mockResolvedValue({ addresses: new Set(), domains: [], patterns: [] }),
  refusalReason: jest.fn().mockReturnValue(null),
  // The mailbox claim is covered in preSignUpEmailClaim.test.js.
  canonicalizeEmail: () => null,
}));
jest.mock('/opt/dynamodb', () => ({ runQuery: jest.fn() }));

const { handler } = require('../lib/handlers/cognitoTriggers/preSignUp');

const signUp = (attributes) => ({
  userPoolId: 'pool',
  triggerSource: 'PreSignUp_SignUp',
  request: { userAttributes: { email: 'someone@example.com', ...attributes } },
});

describe('PreSignUp phone check', () => {
  beforeEach(() => mockLoggerInfo.mockClear());

  it('refuses a mobile number no SMS could reach', async () => {
    await expect(handler(signUp({ 'custom:mobilePhone': '586588' })))
      .rejects.toThrow(/area code/);
  });

  it('refuses a bad home number too', async () => {
    await expect(handler(signUp({ 'custom:secondaryNumber': '12' })))
      .rejects.toThrow(/area code/);
  });

  it('counts the refusal without logging the number', async () => {
    await expect(handler(signUp({ 'custom:mobilePhone': '586588' }))).rejects.toThrow();
    expect(mockLoggerInfo).toHaveBeenCalledWith('event=signup_phone_refused', { attribute: 'custom:mobilePhone' });
    const logged = JSON.stringify(mockLoggerInfo.mock.calls);
    expect(logged).not.toContain('586588');
  });

  it('allows a NANP number and an international one', async () => {
    for (const number of ['2505550123', '(250) 555-0123', '+447911123456']) {
      await expect(handler(signUp({ 'custom:mobilePhone': number }))).resolves.toBeTruthy();
    }
  });

  it('allows a signup with no phone attributes at all', async () => {
    // BCSC accounts arrive without one and add it in account settings.
    await expect(handler(signUp({}))).resolves.toBeTruthy();
    await expect(handler(signUp({ 'custom:mobilePhone': '' }))).resolves.toBeTruthy();
  });
});
