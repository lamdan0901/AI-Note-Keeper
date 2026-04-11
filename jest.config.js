/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/build/',
    '<rootDir>/apps/mobile/.eas-inspect/',
  ],
  testPathIgnorePatterns: ['<rootDir>/apps/mobile/.eas-inspect/'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
          allowJs: true,
        },
      },
    ],
  },
  // Allow transforming ES modules from node_modules
  transformIgnorePatterns: ['node_modules/(?!(js-sha256|convex)/)'],
  // Map module paths for better resolution
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
