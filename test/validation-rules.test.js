const { rulesFns } = require('../src/common/validation-rules');

// Mock Exception class for testing
class Exception extends Error {
  constructor(message, { code }) {
    super(message);
    this.code = code;
  }
}

// Patch Exception in rulesFns prototype for testing
rulesFns.prototype.Exception = Exception;

describe('rulesFns', () => {
  let rules;

  beforeEach(() => {
    rules = new rulesFns();
    // Patch Exception for all methods
    rules.Exception = Exception;
  });

  describe('regexMatch', () => {
    it('should not throw if value matches regex', () => {
      let threw = false;
      try {
        rules.regexMatch('123', /^\d+$/);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw if value does not match regex', () => {
      let threw = false;
      try {
        rules.regexMatch('abc', /^\d+$/);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectType', () => {
    it('should not throw for correct type', () => {
      let threw = false;
      try {
        rules.expectType('foo', ['string']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw for incorrect type', () => {
      let threw = false;
      try {
        rules.expectType(123, ['string']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectArray', () => {
    it('should not throw for valid array and types', () => {
      let threw = false;
      try {
        rules.expectArray([1, 2, 3], ['number']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw if not array', () => {
      let threw = false;
      try {
        rules.expectArray('not array', ['number']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
    it('should throw if array contains wrong type', () => {
      let threw = false;
      try {
        rules.expectArray([1, '2'], ['number']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
    it('should throw if array too short', () => {
      let threw = false;
      try {
        rules.expectArray([1], ['number'], 2);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
    it('should throw if array too long', () => {
      let threw = false;
      try {
        rules.expectArray([1, 2, 3], ['number'], null, 2);
      } catch (e) {
        threw = true;
      }
    });
  });

  describe('expectAction', () => {
    it('should not throw for allowed action', () => {
      let threw = false;
      try {
        rules.expectAction('read', ['read', 'write']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw for disallowed action', () => {
      let threw = false;
      try {
        rules.expectAction('delete', ['read', 'write']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectInteger', () => {
    it('should not throw for positive integer', () => {
      let threw = false;
      try {
        rules.expectInteger(5);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw for non-integer', () => {
      let threw = false;
      try {
        rules.expectInteger(1.5);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
    it('should throw for negative integer if not allowed', () => {
      let threw = false;
      try {
        rules.expectInteger(-1);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
    it('should not throw for negative integer if allowed', () => {
      let threw = false;
      try {
        rules.expectInteger(-2, true);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
  });

  describe('expectCurrency', () => {
    it('should not throw for valid currency', () => {
      let threw = false;
      try {
        rules.expectCurrency(12.34);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw for negative currency if not allowed', () => {
      let threw = false;
      try {
        rules.expectCurrency(-1.23);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
    it('should not throw for negative currency if allowed', () => {
      let threw = false;
      try {
        rules.expectCurrency(-1.23, true);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw for more than 2 decimals', () => {
      let threw = false;
      try {
        rules.expectCurrency(1.234);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectValueInList', () => {
    it('should not throw if value is in list', () => {
      let threw = false;
      try {
        rules.expectValueInList('a', ['a', 'b']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw if value is not in list', () => {
      let threw = false;
      try {
        rules.expectValueInList('c', ['a', 'b']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectEmailFormat', () => {
    it('should not throw for valid email', () => {
      let threw = false;
      try {
        rules.expectEmailFormat('test@example.com');
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw for invalid email', () => {
      let threw = false;
      try {
        rules.expectEmailFormat('not-an-email');
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expect10DigitPhoneFormat', () => {
    it('should not throw for valid phone', () => {
      let threw = false;
      try {
        rules.expect10DigitPhoneFormat('1234567890');
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw for invalid phone', () => {
      let threw = false;
      try {
        rules.expect10DigitPhoneFormat('12345');
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectMoneyFormat', () => {
    it('should not throw for valid money', () => {
      let threw = false;
      try {
        rules.expectMoneyFormat(123.45);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw for invalid money', () => {
      let threw = false;
      try {
        rules.expectMoneyFormat(123.4);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectLatitude', () => {
    it('should not throw for valid latitude', () => {
      let threw = false;
      try {
        rules.expectLatitude(45);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw for invalid latitude', () => {
      let threw = false;
      try {
        rules.expectLatitude(-100);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectLongitude', () => {
    it('should not throw for valid longitude', () => {
      let threw = false;
      try {
        rules.expectLongitude(100);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw for invalid longitude', () => {
      let threw = false;
      try {
        rules.expectLongitude(-200);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectPrimaryKey', () => {
    it('should not throw for valid pk/sk', () => {
      let threw = false;
      try {
        rules.expectPrimaryKey({ pk: 'a', sk: 'b' });
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw for missing pk', () => {
      let threw = false;
      try {
        rules.expectPrimaryKey({ sk: 'b' });
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
    it('should throw for extra property', () => {
      let threw = false;
      try {
        rules.expectPrimaryKey({ pk: 'a', sk: 'b', extra: 1 });
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
    it('should throw for non-string pk/sk', () => {
      let threw = false;
      try {
        rules.expectPrimaryKey({ pk: 1, sk: 'b' });
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectObjectMustHaveProperties', () => {
    it('should not throw if all properties present', () => {
      let threw = false;
      try {
        rules.expectObjectMustHaveProperties({ a: 1, b: 2 }, ['a', 'b']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw if missing property', () => {
      let threw = false;
      try {
        rules.expectObjectMustHaveProperties({ a: 1 }, ['a', 'b']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectObjectToOnlyHaveProperties', () => {
    it('should not throw if only allowed properties', () => {
      let threw = false;
      try {
        rules.expectObjectToOnlyHaveProperties({ a: 1, b: 2 }, ['a', 'b']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw if extra property', () => {
      let threw = false;
      try {
        rules.expectObjectToOnlyHaveProperties({ a: 1, b: 2, c: 3 }, ['a', 'b']);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe('expectObjectToHaveMinNumberOfProperties', () => {
    it('should not throw if at least min properties present', () => {
      let threw = false;
      try {
        rules.expectObjectToHaveMinNumberOfProperties({ a: 1, b: 2 }, ['a', 'b', 'c'], 1);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });
    it('should throw if less than min properties present', () => {
      let threw = false;
      try {
        rules.expectObjectToHaveMinNumberOfProperties({ a: 1 }, ['b', 'c'], 1);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });
});
