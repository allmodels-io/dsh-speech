import { expect, test } from '@playwright/test'
import {
  composerInput,
  connectMockCredential,
  expectBoxesDoNotOverlap,
  loadHarness,
  microphoneButton,
  waitForPartial,
} from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await loadHarness(page)
  await connectMockCredential(page)
})

test('virtual microphone streams, commits, unlocks, and never auto-sends', async ({ page }) => {
  const input = composerInput(page)
  await input.fill('Existing draft')
  const nativeSendStyle = await page.getByRole('button', { name: 'Send message' }).evaluate(element => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return {
      background: style.backgroundColor,
      borderRadius: style.borderRadius,
      color: style.color,
      height: box.height,
      width: box.width,
    }
  })
  await microphoneButton(page).click()

  await expect(page.locator('.dsh-speech-recording-progress')).toHaveText('Preparing microphone…')
  await expect(page.locator('.dsh-speech-recording-canvas')).toHaveCount(0)

  const canvas = page.locator('.dsh-speech-recording-canvas')
  await expect(canvas).toBeVisible({ timeout: 15_000 })
  await expect(input).not.toBeEditable()
  const takeover = page.locator('.dsh-speech-recording-takeover')
  const cancel = page.getByRole('button', { name: 'Cancel voice input' })
  const stop = page.getByRole('button', { name: 'Stop voice input' })
  const send = page.getByRole('button', { name: 'Finish voice input and send' })
  const [takeoverBox, cancelBox, stopBox, sendBox] = await Promise.all([
    takeover.boundingBox(), cancel.boundingBox(), stop.boundingBox(), send.boundingBox(),
  ])
  expect(takeoverBox).not.toBeNull()
  expect(cancelBox).not.toBeNull()
  expect(stopBox).not.toBeNull()
  expect(sendBox).not.toBeNull()
  expect(cancelBox!.x).toBeLessThan(stopBox!.x)
  expect(stopBox!.x).toBeLessThan(sendBox!.x)
  expect(sendBox!.x + sendBox!.width).toBeGreaterThan(takeoverBox!.x + takeoverBox!.width - 50)
  expect(takeoverBox!.width).toBeGreaterThan(600)
  expect(takeoverBox!.x + takeoverBox!.width).toBeLessThanOrEqual(1280)

  const firstWave = await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL())
  await expect.poll(
    async () => canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL()),
    { timeout: 2_000, intervals: [80, 120, 180, 250] },
  ).not.toBe(firstWave)

  await expect(page.getByRole('button', { name: /Access mode/u })).toBeHidden()
  await expect(page.getByRole('button', { name: /Select model/u })).toBeHidden()
  const microphoneSelector = page.locator('.dsh-speech-device-dock[data-variant="hero"]')
  await expect(microphoneSelector).toBeVisible()
  const creatorMode = page.getByRole('button', { name: /^(?:Creator|Standard) mode$/u })
  const [selectorBox, creatorBox] = await Promise.all([microphoneSelector.boundingBox(), creatorMode.boundingBox()])
  expect(selectorBox).not.toBeNull()
  expect(creatorBox).not.toBeNull()
  expectBoxesDoNotOverlap(selectorBox!, creatorBox!)

  const selectorTrigger = microphoneSelector.getByRole('button', { name: /^Microphone:/u })
  await selectorTrigger.click()
  const menu = page.getByRole('menu', { name: 'Microphone' })
  await expect(menu).toBeVisible()
  const menuStyle = await menu.evaluate(element => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return { backgroundColor: style.backgroundColor, color: style.color, right: box.right, bottom: box.bottom }
  })
  expect(menuStyle.backgroundColor).not.toBe('rgb(255, 255, 255)')
  expect(menuStyle.color).not.toBe(menuStyle.backgroundColor)
  expect(menuStyle.right).toBeLessThanOrEqual(1280)
  expect(menuStyle.bottom).toBeLessThanOrEqual(900)
  await page.keyboard.press('Escape')

  await waitForPartial(page, 'Existing draft hello world')
  await expect(send).toBeEnabled()
  const recordingSendStyle = await send.evaluate(element => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return {
      background: style.backgroundColor,
      borderRadius: style.borderRadius,
      color: style.color,
      height: box.height,
      width: box.width,
    }
  })
  expect(recordingSendStyle).toEqual(nativeSendStyle)
  await stop.click()
  await expect(page.locator('.dsh-speech-recording-progress')).toHaveText('Finishing transcription…')
  await expect(microphoneButton(page)).toHaveAccessibleName('Start voice input', { timeout: 10_000 })
  await expect(input).toBeEditable()
  await expect(input).toHaveValue('Existing draft hello world')
  await expect(page.locator('[data-slot="conversation.session"]')).toBeEmpty()
})

test('recording Send finalizes the transcript and submits it once', async ({ page }) => {
  const input = composerInput(page)
  await input.fill('Voice draft')
  await microphoneButton(page).click()
  await waitForPartial(page, 'Voice draft hello world')

  const send = page.getByRole('button', { name: 'Finish voice input and send' })
  await expect(send).toBeEnabled()
  await send.click()

  await expect(page.locator('.dsh-speech-recording-progress')).toHaveText('Finishing transcription…')
  await expect(microphoneButton(page)).toHaveAccessibleName('Start voice input', { timeout: 10_000 })
  const session = page.locator('[data-slot="conversation.session"]')
  await expect(session.getByText('Voice draft hello world', { exact: true })).toHaveCount(1)
  await expect(input).toHaveValue('')
})

test('Cancel discards every active transcription change and restores the original draft', async ({ page }) => {
  const input = composerInput(page)
  await input.fill('Keep this exact draft')
  await microphoneButton(page).click()
  await waitForPartial(page, 'Keep this exact draft hello world')

  await page.getByRole('button', { name: 'Cancel voice input' }).click()

  await expect(microphoneButton(page)).toHaveAccessibleName('Start voice input')
  await expect(input).toBeEditable()
  await expect(input).toHaveValue('Keep this exact draft')
  await expect(page.locator('.dsh-speech-recording-takeover')).toHaveCount(0)
})
