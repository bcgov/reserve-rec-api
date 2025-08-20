module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.js'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  moduleNameMapper: {
    '^/opt/awsUtils/s3$': '<rootDir>/lib/layers/awsUtils/s3.js',
    '^/opt/awsUtils/ses$': '<rootDir>/lib/layers/awsUtils/ses.js',
    '^/opt/awsUtils/sns$': '<rootDir>/lib/layers/awsUtils/sns.js',
    '^/opt/base$': '<rootDir>/lib/layers/base/base.js',
    '^/opt/clients/configs$': '<rootDir>/lib/layers/dataUtils/clients/configs.js',
    '^/opt/clients/methods$': '<rootDir>/lib/layers/dataUtils/clients/methods.js',
    '^/opt/data-utils$': '<rootDir>/lib/layers/dataUtils/data-utils.js',
    '^/opt/data-constants$': '<rootDir>/lib/layers/dataUtils/data-constants.js',
    '^/opt/dynamodb$': '<rootDir>/lib/layers/awsUtils/dynamodb.js',
    '^/opt/locations/configs$': '<rootDir>/lib/layers/dataUtils/locations/configs.js',
    '^/opt/locations/methods$': '<rootDir>/lib/layers/dataUtils/locations/methods.js',
    '^/opt/resources/configs$': '<rootDir>/lib/layers/dataUtils/resources/configs.js',
    '^/opt/resources/methods$': '<rootDir>/lib/layers/dataUtils/resources/methods.js',
    '^/opt/users/configs$': '<rootDir>/lib/layers/dataUtils/users/configs.js',
    '^/opt/users/methods$': '<rootDir>/lib/layers/dataUtils/users/methods.js',
    '^/opt/validation-rules$': '<rootDir>/lib/layers/dataUtils/validation-rules.js',
  }
};
