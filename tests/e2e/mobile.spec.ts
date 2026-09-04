import { expect, test } from '@playwright/test'
import { composerInput, connectMockCredential, expectComposerText, loadHarness, microphoneButton, waitForPartial } from './helpers.ts'

test('mobile recording fits the composer and omits the microphone selector', async ({ page }) => {
  await loadHarness(page)
  await connectMockCredential(page)
  const input = composerInput(page)
  await input.fill('Mobile draft')
  await microphoneButton(page).click()
  await waitForPartial(page, 'Mobile draft hello world')

  const takeover = page.locator('.dsh-speech-recording-takeover')
  const takeoverBox = await takeover.boundingBox()
  expect(takeoverBox).not.toBeNull()
  expect(takeoverBox!.x).toBeGreaterThanOrEqual(0)
  expect(takeoverBox!.x + takeoverBox!.width).toBeLessThanOrEqual(390)
  await expect(page.locator('.dsh-speech-device-dock')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Cancel voice input' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop voice input' })).toBeVisible()
  const send = page.getByRole('button', { name: 'Finish voice input and send' })
  await expect(send).toBeVisible()
  await expect(send).toBeEnabled()

  await page.getByRole('button', { name: 'Cancel voice input' }).click()
  await expectComposerText(input, 'Mobile draft')
  await expect(input).toBeEditable()
})
