module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/src'],
  testMatch: ['**/*.test.js'],
  // Integration tests need a running API; they run via jest.integration.config.js
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test/integration/'],
  transformIgnorePatterns: ['node_modules/'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/layers/**/nodejs/**',
    '!src/scripts/**',
    '!**/node_modules/**',
    '!**/__tests__/**',
  ],
  moduleNameMapper: {
    '^/opt/awsUtils/ses$': '<rootDir>/src/layers/awsUtils/ses.js',
    '^/opt/awsUtils/sns$': '<rootDir>/src/layers/awsUtils/sns.js',
    '^/opt/base$': '<rootDir>/src/layers/base/base.js',
    '^/opt/dynamodb$': '<rootDir>/src/layers/awsUtils/dynamodb.js',
    '^/opt/emailBlocklist$': '<rootDir>/src/layers/base/emailBlocklist.js',
    '^/opt/opensearch$': '<rootDir>/src/layers/awsUtils/opensearch.js',
    '^/opt/phone$': '<rootDir>/src/layers/base/phone.js',
    '^/opt/signupLinks$': '<rootDir>/src/layers/base/signupLinks.js',
    '^/opt/ssm$': '<rootDir>/src/layers/awsUtils/ssm.js',
  }
};
