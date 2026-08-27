import { expect, test } from '@playwright/test'
import { composerInput, loadHarness, microphoneButton, openSpeechSettings } from './helpers.ts'

test('real AllModels and DeepSeek credentials support a trusted main-branch smoke run', async ({ page }) => {
  test.setTimeout(120_000)
  await loadHarness(page)

  const dialog = await openSpeechSettings(page)
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/Credential source: env/u)).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Recognition' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Balance' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()

  const input = composerInput(page)
  await microphoneButton(page).click()
  await expect(page.locator('.dsh-speech-recording-canvas')).toBeVisible({ timeout: 30_000 })
  await expect(input).not.toBeEditable()
  await page.waitForTimeout(1_000)
  await page.getByRole('button', { name: 'Stop voice input' }).click()
  await expect(microphoneButton(page)).toHaveAccessibleName('Start voice input', { timeout: 15_000 })
  await expect(input).toBeEditable()

  await input.fill('Reply with exactly OK and nothing else.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('[data-slot="conversation.session"]')).toContainText(/\bOK\b/u, { timeout: 90_000 })

  await microphoneButton(page).click()
  await expect(page.locator('.dsh-speech-recording-canvas')).toBeVisible({ timeout: 30_000 })
  const metrics = page.locator('[data-slot="conversation.composer.dock"] > *').filter({ hasText: 'TTFT' }).first()
  await expect(metrics).toContainText('TTFT')
  const separator = page.locator('.dsh-speech-device-separator')
  const selector = page.locator('.dsh-speech-device-dock[data-variant="metrics"]')
  await expect(separator).toHaveText('|')
  await expect(selector).toBeVisible()
  const [metricsBox, separatorBox, selectorBox] = await Promise.all([
    metrics.boundingBox(), separator.boundingBox(), selector.boundingBox(),
  ])
  expect(metricsBox).not.toBeNull()
  expect(separatorBox).not.toBeNull()
  expect(selectorBox).not.toBeNull()
  expect(separatorBox!.x).toBeGreaterThan(metricsBox!.x)
  expect(selectorBox!.x).toBeGreaterThan(separatorBox!.x)
  await page.getByRole('button', { name: 'Cancel voice input' }).click()
})
