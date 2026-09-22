import { expect, test } from '@playwright/test'
import { composerInput, expectSessionMicrophonePlacement, loadHarness, microphoneButton, openSpeechSettings } from './helpers.ts'

test('real AllModels and DeepSeek credentials support a trusted main-branch smoke run', async ({ page }) => {
  test.setTimeout(120_000)
  expect(process.env.ALLMODELS_API_KEY).toBeUndefined()
  expect(process.env.DEEPSEEK_API_KEY).toBeUndefined()
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

  await expect(page.getByRole('button', { name: 'Spoken summary unavailable for this answer' })).toHaveCount(0)
  await expect(page.locator('.dsh-speech-summary-player').last()).toHaveAttribute('data-phase', /^(?:ready|playing)$/u, { timeout: 90_000 })
  await expect(page.getByRole('button', { name: /^(?:Pause|Play|Replay|Resume) summary$/u }).last()).toBeEnabled()

  await microphoneButton(page).click()
  await expect(page.locator('.dsh-speech-recording-canvas')).toBeVisible({ timeout: 30_000 })
  await expectSessionMicrophonePlacement(page)
  await page.getByRole('button', { name: 'Cancel voice input' }).click()
})
