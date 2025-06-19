const { DateTime, Exception } = require('/opt/base');

class rulesFns {

  regexMatch(value, regex) {
    if (!regex.test(value)) {
      throw new Exception(`Invalid value: Expected '${value}' to match regex: ${regex}.`, { code: 400 });
    }
  }

  /**
   * Validates that the type of a given value matches one of the expected types.
   *
   * @param {*} value - The value to be checked.
   * @param {string[]} types - An array of expected types as strings.
   * @throws {Exception} Throws an exception if the type of the value does not match any of the expected types.
   */
  expectType(value, types) {
    if (!types.includes(typeof value)) {
      throw new Exception(`Invalid type: Expected '${value}' (type: '${typeof value}') to be one of type: [${types}].`, { code: 400 });
    }
  }

  /**
   * Validates that the array matches the expected type
   *
   * @param {Array} value - The array value to be checked.
   * @param {string[]} type - An array of expected primitive types as strings that the array contains.
   * @param {number} [minLength=null] - The minimum length of the array. If specified, the array must have at least this many elements.
   * @param {number} [maxLength=null] - The maximum length of the array. If specified, the array must have at most this many elements.
   * @throws {Exception} Throws an exception if the value is not an array and if any of the values does not match the expected type, or the array does not meet the length requirements.
   */
  expectArray(value, type = null, minLength = null, maxLength = null) {
    if (!Array.isArray(value)) {
      throw new Exception(`Invalid value: expected '${value}' to be an array.`, { code: 400 });
    }
    if (type && !value.every(item => type.includes(typeof item))) {
      const actualTypes = value.map(i => typeof i);
      throw new Exception(`Invalid types in array: expected items to be one of: [${type}], but got: [${actualTypes}].`, { code: 400 });
    }
    if (minLength > 0 && value.length < minLength) {
      throw new Exception(`Invalid array length: expected at least ${minLength} items, but got ${value.length}.`, { code: 400 });
    }
    if (maxLength && value.length > maxLength) {
      throw new Exception(`Invalid array length: expected at most ${maxLength} items, but got ${value.length}.`, { code: 400 });
    }
  }

  /**
   * Validates if the provided action is included in the list of allowed actions.
   * Throws an exception if the action is not permitted.
   *
   * @param {string} action - The action to validate.
   * @param {string[]} actions - The list of allowed actions.
   * @throws {Exception} Throws an exception if the action is not in the list of allowed actions.
   */
  expectAction(action, allowedActions) {
    if (!allowedActions.includes(action)) {
      throw new Exception(`Invalid action: Expected '${action}' to be one of: [${allowedActions}]. Action '${action}' is not permitted on this field.`, { code: 400 });
    }
  }

  /**
   * Validates that the given value is an object representing a 24-hour time format.
   * The object should contain at least the 'hour' property and optionally 'minute' and 'second' properties.
   *
   * @param {Object} value - The object to validate.
   * @param {number} value.hour - The hour value (0-23).
   * @param {number} [value.minute] - The optional minute value (0-59).
   * @param {number} [value.second] - The optional second value (0-59).
   * @throws {Exception} Throws an exception if the object does not match the expected format.
   */
  expect24hTimeObjFormat(value) {
    const timeIncrements = ['hour', 'minute', 'second'];
    for (const key in value) {
      if (!timeIncrements.includes(key)) {
        throw new Exception(`Invalid time format: Expected {hour: <0-23>, minute?: <0-59>, second?: <0-59>}.  'Received: '${JSON.stringify(value, null, 2)}'.`, { code: 400 });
      }
      this.expectInteger(value[key]);
    }
    if (!value || !value?.hour || !Object.keys(timeIncrements).some(key => value.includes(key))) {
      throw new Exception(`Invalid time format: Expected {hour: <0-23>, minute?: <0-59>, second?: <0-59>}. 'Received: '${JSON.stringify(value, null, 2)}'.`, { code: 400 });
    }
  }

  /**
   * Validates that a given value is present in a specified list.
   *
   * @param {*} value - The value to check.
   * @param {Array} list - The list of valid values.
   * @throws {Exception} Throws an exception if the value is not in the list, with a message indicating the invalid value and the expected list.
   */
  expectValueInList(value, list) {
    if (!list.includes(value)) {
      throw new Exception(`Invalid value: Expected '${value}' to be one of: [${list.join(', ') || list}].`, { code: 400 });
    }
  }

  /**
   * Validates the format of a duration object.
   *
   * The duration object can contain the following optional properties:
   * - years: <number>
   * - months: <number>
   * - weeks: <0-3>
   * - days: <0-6>
   * - hours: <0-23>
   * - minutes: <0-59>
   * - seconds: <0-59>
   *
   * Each property, if present, must be an integer.
   *
   * @param {Object} value - The duration object to validate.
   * @throws {Exception} Throws an exception if the duration object contains invalid keys or values.
   */
  expectDurationObjFormat(value) {
    const durationIncrements = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'];
    for (const key in value) {
      if (!durationIncrements.includes(key)) {
        throw new Exception(`Invalid duration format: Expected {years?: <number>, months?: <number>, weeks?: <0-3>, days?: <0-6>, hours?: <0-23>, minutes?: <0-59>, seconds?: <0-59>}. 'Received: '${JSON.stringify(value, null, 2)}'.`, { code: 400 });
      }
      this.expectInteger(value[key]);
    }
    if (!value || !Object.keys(durationIncrements).some(key => value.includes(key))) {
      throw new Exception(`Invalid duration format: Expected {years?: <number>, months?: <number>, weeks?: <number>, days?: <number>, hours?: <number>, minutes?: <number>, seconds?: <number>}. 'Received: '${JSON.stringify(value, null, 2)}'.`, { code: 400 });
    }
  }

  /**
   * Validates that the provided value is an integer.
   *
   * @param {number} value - The value to be validated.
   * @param {boolean} [allowNegative=false] - Whether negative integers are allowed.
   * @throws {Exception} Throws an exception if the value is not an integer or if negative integers are not allowed and the value is negative.
   */
  expectInteger(value, allowNegative = false) {
    if (!Number.isInteger(value)) {
      throw new Exception(`Invalid value: Expected '${value}' (type: '${typeof value}') to be an integer.`, { code: 400 });
    }
    if (!allowNegative && value < 0) {
      throw new Exception(`Invalid value: Expected '${value}' (type: '${typeof value}') to be a non-negative integer.`, { code: 400 });
    }
  }

  /**
   * Validates that the given value is a currency amount (enforces 0-2 decimal places).
   *
   * @param {number} value - The value to be validated as currency.
   * @param {boolean} [allowNegative=false] - Whether to allow negative currency values.
   * @throws {Exception} Throws an exception if the value is negative and allowNegative is false.
   */
  expectCurrency(value, allowNegative = false) {
    this.expectType(value, ['number']);
    if (!allowNegative && value < 0) {
      throw new Exception(`Invalid value: Expected currency value to be positive. Received: '${value}'.`, { code: 400 });
    }
    this.regexMatch(value, new RegExp("^-?\\d+(?:\\.\\d{1,2})?$"));
  }

  /**
   * Validates if the given value is in ISO 8601 date string format.
   * Throws an exception if the value is not a valid ISO 8601 date string.
   *
   * @param {string} value - The date string to validate.
   * @throws {Exception} Throws an exception if the date format is invalid.
   */
  expectISODateTimeObjFormat(value) {
    const d = new Date(value);
    if (d.toISOString() !== value) {
      throw new Exception(`Invalid date format: Expected ISO 8601 date string. Received: '${value}'.`, { code: 400 });
    };
  }

  /**
   * Validates if the given value is in the expected ISO date string format.
   *
   * @param {string} value - The date string to validate.
   * @param {string} [format='yyyy-LL-dd'] - The expected date format. Defaults to 'yyyy-LL-dd'.
   * @throws {Exception} Throws an exception if the date string is not in the expected format.
   */
  expectISODateObjFormat(value, format = 'yyyy-LL-dd') {
    let dateTime = DateTime.fromFormat(value, format);
    if (!dateTime || !dateTime.isValid) {
      throw new Exception(`Date or date format is invalid: Expected ISO date string in the format ${format}. Received '${value}'.`, { code: 400 });
    }
  }

  /**
   * Validates that a number is within a specified range.
   *
   * @param {number} value - The number to validate.
   * @param {number} min - The minimum value of the range.
   * @param {number} max - The maximum value of the range.
   * @param {boolean} [inclusive=true] - Whether the range is inclusive. If true, the value can be equal to min or max.
   * @throws {Exception} Throws an exception if the value is not within the specified range.
   */
  expectInRange(value, min, max, inclusive = true) {
    this.expectType(value, ['number']);
    if (inclusive) {
      if (value < min || value > max) {
        throw new Exception(`Invalid value: Expected '${value}' to be equal to or between ${min} and ${max}.`, { code: 400 });
      } else {
        if (value <= min || value >= max) {
          throw new Exception(`Invalid value: Expected '${value}' to be between ${min} and ${max}.`, { code: 400 });
        }
      }
    }
  }

  /**
   * Validates that the given latitude value is within the acceptable range.
   *
   * @param {number} value - The latitude value to be validated.
   * @throws {RangeError} Throws an error if the latitude value is not within the range of -90 to 90.
   */
  expectLatitude(value) {
    this.expectInRange(value, -90, 90);
  }

  /**
   * Validates that the given value is a valid longitude.
   * Longitude must be within the range of -180 to 180 degrees.
   *
   * @param {number} value - The value to be validated as a longitude.
   */
  expectLongitude(value) {
    this.expectInRange(value, -180, 180);
  }

  /**
   * Validates if the provided value is a valid GeoJSON Point object.
   *
   * @param {Object} value - The value to be validated.
   * @param {string} value.type - The type of the GeoJSON object, expected to be 'Point'.
   * @param {Array} value.coordinates - The coordinates of the GeoJSON Point, expected to be an array with two elements of the format [longitude, latitude].
   * @throws {Exception} Throws an exception if the type is not 'Point' or if the coordinates are not a valid array with two elements.
   */
  expectGeopoint(value) {
    if (!value?.type || value?.type !== 'point') {
      throw new Exception(`Invalid geopoint type: Expected 'type' to be 'point'. Received: '${value?.type}'.`, { code: 400 });
    }
    const coords = value?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) {
      throw new Exception(`Invalid geopoint coordinates: Expected coordinates to be an array with two elements. Received: '${value?.coordinates}'.`, { code: 400 });
    }
    this.expectLongitude(coords[0]);
    this.expectLatitude(coords[1]);
  }

  /**
   * Validates if the provided value is a valid GeoJSON Envelope object.
   *
   * @param {Object} value - The value to be validated.
   * @param {string} value.type - The type of the GeoJSON object, expected to be 'Envelope'.
   * @param {Array} value.coordinates - The coordinates of the GeoJSON shape, expected to be an array of arrays with at least two elements of the format [longitude, latitude].
   * @throws {Exception} Throws an exception if the type is not 'Envelope' or if the coordinates are not a valid array or arrays with at least two elements.
   */
  expectGeoshape(value) {
    // Type validation
    if (!value?.type || (value.type !== 'envelope' && value.type !== 'polygon')) {
      throw new Exception(`Invalid geoshape type: Expected 'type' to be 'envelope' or 'polygon'. Received: '${value?.type}'.`, { code: 400 });
    }

    // Coordinates validation
    const coords = value.coordinates;

    // Check if coordinates exists and is an array
    if (!Array.isArray(coords)) {
      throw new Exception(`Invalid geoshape: Coordinates must exist and be an array. Received: '${value?.coordinates}'.`, { code: 400 });
    }

    // Get the array of points
    const points = coords[0];

    // Ensure we have at least two points
    if (!Array.isArray(points) || points.length < 2) {
      throw new Exception(`Invalid geoshape point coordinates: Expected coordinates to be an array with at least two elements. Received: '${value?.coordinates}'.`, { code: 400 });
    }

    // Validate each point
    for (let i = 0; i < points.length; i++) {
      const point = points[i];

      this.expectLongitude(point[0]);
      this.expectLatitude(point[1]);
    }
  }

  /**
   * Validates that the provided value is a valid envelope object.
   *
   * An envelope object must have a `type` property with the value `'envelope'`
   * and a `coordinates` property that is an array containing exactly two points.
   * Each point must be an array with valid longitude and latitude values.
   *
   * @param {Object} value - The envelope object to validate.
   * @param {string} value.type - The type of the object, which must be `'envelope'`.
   * @param {Array} value.coordinates - An array of two points representing the envelope.
   * @throws {Exception} Throws an error if the `type` is not `'envelope'`.
   * @throws {Exception} Throws an error if `coordinates` is not an array of two points.
   * @throws {Exception} Throws an error if any point does not have valid longitude or latitude.
   */
  expectEnvelope(value) {
    // Type validation
    if (!value?.type || value.type !== 'envelope') {
      throw new Exception(`Invalid envelope type: Expected 'type' to be 'envelope'. Received: ${value?.type}'.`, { code: 400 });
    }

    // Coordinates validation
    const coords = value.coordinates;

    // Check if coordinates exists and is an array
    if (!Array.isArray(coords)) {
      throw new Exception(`Invalid envelope: Coordinates must exist and be an array. Received: '${value?.coordinates}'.`, { code: 400 });
    }

    // Ensure we have exactly two points
    if (!Array.isArray(coords) || coords.length !== 2) {
      throw new Exception(`Invalid envelope point coordinates: Expected coordinates to be an array with at least two elements. Received: '${value?.coordinates}'.`, { code: 400 });
    }

    // Validate each point
    for (let i = 0; i < coords.length; i++) {
      const point = coords[i];
      this.expectLongitude(point[0]);
      this.expectLatitude(point[1]);
    }
  }

  /**
   * Validates that the provided value is a valid primary key object.
   *
   * The primary key object must:
   * - Contain only the properties 'pk' and 'sk'.
   * - Have both 'pk' and 'sk' as strings.
   *
   * @param {Object} value - The object to validate as a primary key.
   * @throws {Exception} Throws an exception if the object does not meet the validation criteria.
   */
  expectPrimaryKey(value) {
    // Expect the only properties to be 'pk' and 'sk'
    try {
      this.expectObjectMustHaveProperties(value, ['pk', 'sk']);
      this.expectObjectToOnlyHaveProperties(value, ['pk', 'sk']);
    } catch (error) {
      throw new Exception(`Invalid primary key: Expected { pk: <string>, sk: <string> }. Received: '${JSON.stringify(value, null, 2)}'.`, { code: 400 });
    }
    for (const key in value) {
      this.expectType(value[key], ['string']);
    }
  }

  // Expect the object to definitely have the properties provided (but may have more)
  expectObjectMustHaveProperties(value, properties) {
    const keys = Object.keys(value);
    let missingKeys = properties.filter(property => !keys.includes(property));
    if (missingKeys.length > 0) {
      throw new Exception(`Invalid object: Expected object to have all properties: '${properties.join(', ') || properties}'. Missing properties: '${missingKeys.join(', ')}'. Received: '[${keys.join(', ') || keys}]'.`, { code: 400 });
    }
  }

  // Expect the object to only have these properties
  expectObjectToOnlyHaveProperties(value, properties) {
  const keys = Object.keys(value);
  const extraKeys = keys.filter(key => !properties.includes(key));
    if (extraKeys.length > 0) {
      throw new Exception(`Invalid object: Expected object to only have properties: '${properties.join(', ')}'. Extra properties found: '${extraKeys.join(', ')}'. Received: '[${keys.join(', ') || keys}]'.`, { code: 400 });
    }
  }
  // Expect the object to have at least the provided minimum number of the properties provided
  // Useful when none of the properties are mandatory, but at least one is required
  expectObjectToHaveMinNumberOfProperties(value, properties, min = 1) {
    const count = properties.filter(prop => value.hasOwnProperty(prop)).length;
    if (count < min) {
      throw new Exception(`Invalid object: Expected object to have at least ${min} properties from '${properties.join(', ')}. 'Received: ''[${Object.keys(value).join(', ') || JSON.stringify(value, null, 2)}]'.`, { code: 400 });
    }
  }

  /**
   * Validates that the given value is a string and matches the email format.
   *
   * @param {string} value - The value to validate as an email.
   * @throws {Exception} Throws an exception if the value is not a string or does not match the email format.
   */
  expectEmailFormat(value) {
    try {
      this.expectType(value, ['string']);
      this.regexMatch(value, /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
    } catch (error) {
      throw new Exception(`Invalid email format: '${value}'.`, { code: 400 });
    }
  }

  /**
   * Validates that the provided value is a string and matches the 10-digit phone number format.
   *
   * @param {string} value - The value to validate as a 10-digit phone number.
   * @throws {Exception} Throws an exception if the value is not a string or does not match the 10-digit phone number format.
   */
  expect10DigitPhoneFormat(value) {
    try {
      this.expectType(value, ['string']);
      this.regexMatch(value, /^\d{10}$/);
    } catch (error) {
      throw new Exception(`Invalid 10 digit phone format: '${value}'.`, { code: 400 });
    }
  }

  /**
   * Validates that the given value is in a valid money format.
   *
   * The value must be of type 'number' and match the regular expression
   * for a monetary value, which allows an optional decimal point followed
   * by exactly two digits (e.g., 123, 123.45).
   *
   * @param {number} value - The value to validate as a money format.
   * @throws {Exception} Throws an exception if the value is not a number
   *                     or does not match the expected money format.
   */
  expectMoneyFormat(value) {
    try {
      this.expectType(value, ['number']);
      this.regexMatch(value, /^\d+(\.\d{2})?$/);
    } catch (error) {
      throw new Exception(`Invalid money format: '${value}'.`, { code: 400 });
    }
  }

}

module.exports = {
  rulesFns
};
