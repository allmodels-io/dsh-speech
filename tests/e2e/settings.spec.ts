import { expect, test } from '@playwright/test'
import {
  MOCK_API_KEY,
  disconnectMockCredential,
  loadHarness,
  microphoneButton,
  openSpeechSettings,
} from './helpers.ts'

test('account setup and the complete Speech settings experience', async ({ page }) => {
  await loadHarness(page)
  await disconnectMockCredential(page)

  const disconnectedMic = microphoneButton(page)
  await expect(disconnectedMic).toHaveAccessibleName('Connect AllModels in Settings → Speech')
  await expect(disconnectedMic).toHaveAttribute('aria-disabled', 'true')
  await disconnectedMic.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Connect AllModels in Settings → Speech')

  const dialog = await openSpeechSettings(page)
  const speechNavigation = dialog.getByRole('button', { name: 'Speech' })
  await expect(speechNavigation).toHaveAttribute('data-dsh-speech-nav', '')
  const microphoneMask = await speechNavigation.evaluate(element => getComputedStyle(element, '::before').maskImage)
  expect(microphoneMask).toContain('svg')

  await expect(dialog.getByRole('heading', { name: 'Sign in or sign up free' })).toBeVisible()
  await expect(dialog.getByText('$1 free credit')).toBeVisible()
  await expect(dialog.getByLabel('Email address')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Send sign-in code' })).toBeDisabled()
  await expect(dialog.getByRole('heading', { name: 'Recognition' })).toHaveCount(0)
  await expect(dialog.getByRole('heading', { name: 'Balance' })).toHaveCount(0)
  await expect(dialog.getByLabel('AllModels API key')).toBeHidden()

  await dialog.getByLabel('Email address').fill('speech-e2e@example.test')
  await dialog.getByRole('button', { name: 'Send sign-in code' }).click()
  await expect(dialog.getByText('A sign-in code was sent. It remains valid for five minutes.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Resend code' })).toBeVisible()
  await dialog.getByLabel('Six-digit code').fill('123456')
  await dialog.getByRole('button', { name: 'Verify and connect' }).click()
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(MOCK_API_KEY)

  await dialog.getByRole('button', { name: 'Disconnect' }).click()
  await expect(dialog.getByRole('heading', { name: 'Sign in or sign up free' })).toBeVisible()

  await dialog.getByText('Connect with an API key instead').click()
  const apiKey = dialog.getByLabel('AllModels API key')
  await expect(apiKey).toHaveAttribute('type', 'password')
  await apiKey.fill(MOCK_API_KEY)
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()

  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Credential source: file')).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Recognition' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Balance' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(MOCK_API_KEY)

  const model = dialog.getByLabel('STT model')
  const provider = dialog.getByLabel('Provider')
  const language = dialog.getByLabel('Language')
  await expect(model).toHaveValue('assemblyai/universal-streaming')
  await expect(provider).toHaveValue('assemblyai')
  await expect(language).toHaveValue('auto')
  for (const label of await model.locator('option').allTextContents()) expect(label).toMatch(/^[^/]+\/.+/u)

  const [modelBox, providerBox, languageBox] = await Promise.all([
    model.boundingBox(), provider.boundingBox(), language.boundingBox(),
  ])
  expect(modelBox).not.toBeNull()
  expect(providerBox).not.toBeNull()
  expect(languageBox).not.toBeNull()
  expect(modelBox!.width).toBeGreaterThan(providerBox!.width * 1.8)
  expect(modelBox!.y + modelBox!.height).toBeLessThanOrEqual(providerBox!.y)
  expect(Math.abs(providerBox!.y - languageBox!.y)).toBeLessThan(3)

  await expect(dialog.getByText('Recognition context', { exact: false })).toHaveCount(0)
  await model.selectOption('soniox/stt-rt-v5')
  await expect(provider).toHaveValue('soniox')
  const contextSummary = dialog.getByText('Recognition context', { exact: false })
  await expect(contextSummary).toBeVisible()
  await expect(dialog.getByLabel('Recognition context')).toBeHidden()
  await contextSummary.click()
  const context = dialog.getByLabel('Recognition context')
  await context.fill('DeepSeek Harness, AllModels')
  await context.blur()
  await expect(dialog.getByRole('status')).toHaveText('Saved')

  await model.selectOption('assemblyai/universal-streaming')
  await expect(dialog.getByLabel('Recognition context')).toBeHidden()
  await model.selectOption('soniox/stt-rt-v5')
  await contextSummary.click()
  await expect(dialog.getByLabel('Recognition context')).toHaveValue('DeepSeek Harness, AllModels')

  await expect(dialog.getByText('$8.25', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Promotion', { exact: true })).toHaveCount(0)
  await expect(dialog.getByText('Usable', { exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Top-up amount (USD)')).toHaveValue('10')
  await dialog.getByRole('button', { name: 'Create top-up link' }).click()
  await expect(dialog.getByRole('link', { name: 'Open secure checkout' }))
    .toHaveAttribute('href', 'https://checkout.example.test/dsh-speech')
})
