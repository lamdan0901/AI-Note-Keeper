/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/build/',
    '<rootDir>/apps/mobile/.eas-inspect/',
    '<rootDir>/appwrite-functions/',
  ],
  testPathIgnorePatterns: ['<rootDir>/apps/mobile/.eas-inspect/'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.[jt]sx?$': [
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
  // convex/* must be included: packages/shared/backend/convex.ts imports convex/browser + convex/react
  // which ship ESM-only and must be transformed by ts-jest.
  transformIgnorePatterns: ['node_modules/(?!(js-sha256|convex)/)'],
  // Map module paths for better resolution
  moduleNameMapper: {
    // Force all node-appwrite imports to root package (prevents per-function node_modules from bypassing mocks)
    '^node-appwrite$': '<rootDir>/node_modules/node-appwrite',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
