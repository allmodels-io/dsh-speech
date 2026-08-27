import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.DSH_SPEECH_E2E_BASE_URL ?? 'http://127.0.0.1:3180'
const audioFile = process.env.DSH_SPEECH_E2E_AUDIO_FILE
const live = process.env.DSH_SPEECH_E2E_MODE === 'live'
const fakeMediaArgs = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  ...(audioFile === undefined ? [] : [`--use-file-for-fake-audio-capture=${audioFile}`]),
]

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 2 : 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results',
  reporter: live
    ? [['line']]
    : process.env.CI === 'true'
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    permissions: ['microphone'],
    colorScheme: 'dark',
    locale: 'en-US',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: { args: fakeMediaArgs },
  },
  projects: live
    ? [{
        name: 'live-chromium',
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width: 1280, height: 900 },
          trace: 'off',
          screenshot: 'off',
          video: 'off',
        },
        testMatch: /live\.spec\.ts/u,
      }]
    : [
        { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } }, testIgnore: /(?:mobile|live)\.spec\.ts/u },
        { name: 'mobile-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } }, testMatch: /mobile\.spec\.ts/u },
      ],
})
