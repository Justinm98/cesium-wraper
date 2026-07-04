import { defineConfig } from '@playwright/test';

/**
 * Real-Cesium WebGL smoke-test config (NFR-A-03 / M2). Separate from the jest
 * unit suite under src/; these specs live under smoke/ and run the library
 * against actual Cesium in headless Chromium.
 *
 * SwiftShader gives software WebGL2 so this runs without a GPU (CI-friendly).
 */
const PORT = 4178;

export default defineConfig({
  testDir: './smoke',
  testMatch: '**/*.smoke.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  webServer: {
    command: 'node smoke/serve.mjs',
    url: `http://localhost:${PORT}/index.html`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
