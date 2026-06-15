/**
 * Jest is configured through jest-preset-angular so that Angular components
 * and services can be tested with TestBed. @cesium/engine is replaced by a
 * manual mock (see src/engines/cesium/__mocks__) because unit tests must not
 * require a WebGL context.
 */
export default {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.html$',
      },
    ],
  },
  moduleNameMapper: {
    '^@cesium/engine$': '<rootDir>/src/engines/cesium/__mocks__/cesium-engine.mock.ts',
    // satellite.js v7 is ESM-only (no "require" export condition); point
    // jest straight at the ESM entry and let the transform below convert it.
    '^satellite\\.js$': '<rootDir>/node_modules/satellite.js/dist/index.js',
  },
  // Extends jest-preset-angular's default pattern (which this key replaces)
  // with satellite.js, since it ships untranspiled ESM.
  transformIgnorePatterns: [
    'node_modules/(?!satellite\\.js/|.*\\.mjs$|@angular/common/locales/.*\\.js$)',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/index.ts',
    '!src/**/__mocks__/**',
    '!src/**/*.spec.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 90,
      functions: 90,
      lines: 90,
    },
  },
};
