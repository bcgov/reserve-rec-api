module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.js'],
  transformIgnorePatterns: ['node_modules/'],
  moduleNameMapper: {
    '^/opt/awsUtils/s3$': '<rootDir>/src/layers/awsUtils/s3.js',
    '^/opt/awsUtils/ses$': '<rootDir>/src/layers/awsUtils/ses.js',
    '^/opt/awsUtils/sns$': '<rootDir>/src/layers/awsUtils/sns.js',
    '^/opt/base$': '<rootDir>/src/layers/base/base.js',
    '^/opt/clients/configs$': '<rootDir>/src/layers/dataUtils/clients/configs.js',
    '^/opt/clients/methods$': '<rootDir>/src/layers/dataUtils/clients/methods.js',
    '^/opt/data-utils$': '<rootDir>/src/layers/dataUtils/data-utils.js',
    '^/opt/data-constants$': '<rootDir>/src/layers/dataUtils/data-constants.js',
    '^/opt/dynamodb$': '<rootDir>/src/layers/awsUtils/dynamodb.js',
    '^/opt/locations/configs$': '<rootDir>/src/layers/dataUtils/locations/configs.js',
    '^/opt/locations/methods$': '<rootDir>/src/layers/dataUtils/locations/methods.js',
    '^/opt/resources/configs$': '<rootDir>/src/layers/dataUtils/resources/configs.js',
    '^/opt/resources/methods$': '<rootDir>/src/layers/dataUtils/resources/methods.js',
    '^/opt/users/configs$': '<rootDir>/src/layers/dataUtils/users/configs.js',
    '^/opt/users/methods$': '<rootDir>/src/layers/dataUtils/users/methods.js',
    '^/opt/validation-rules$': '<rootDir>/src/layers/dataUtils/validation-rules.js',
  }
};
