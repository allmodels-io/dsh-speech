import { expect, type Locator, type Page } from '@playwright/test'

export const MOCK_API_KEY = 'mock-api-key-123'

export function composerInput(page: Page): Locator {
  return page.locator('[data-slot="conversation.composer"] textarea')
}

export function microphoneButton(page: Page): Locator {
  return page.locator('[data-slot="conversation.input.right"] .dsh-speech-mic')
}

async function dismissHarnessFirstRun(page: Page): Promise<void> {
  await page.waitForTimeout(500)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true })
    const configureLater = page.getByRole('button', { name: 'Configure later', exact: true })
    if (await continueButton.isVisible()) {
      await continueButton.click()
      await page.waitForTimeout(350)
      continue
    }
    if (await configureLater.isVisible()) {
      await configureLater.click()
      await page.waitForTimeout(350)
      continue
    }
    return
  }
}

export async function loadHarness(page: Page): Promise<void> {
  if (process.env.DSH_SPEECH_E2E_MODE !== 'live') page.on('console', message => {
    if (message.type() === 'warning' || message.type() === 'error') {
      console.log(`browser ${message.type()}: ${message.text()}`)
    }
  })
  await page.goto('/')
  await dismissHarnessFirstRun(page)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true })
    const configureLater = page.getByRole('button', { name: 'Configure later', exact: true })
    if (await continueButton.isVisible()) {
      await continueButton.click()
      await page.waitForTimeout(350)
      continue
    }
    if (await configureLater.isVisible()) {
      await configureLater.click()
      await page.waitForTimeout(350)
      continue
    }
    const chooseWorkspace = page.getByRole('button', { name: 'Choose workspace' })
    if (await chooseWorkspace.isVisible()) {
      await chooseWorkspace.click({ timeout: 500 }).catch(() => undefined)
      const workspaceChoice = page.getByRole('menu').getByRole('menuitem').first()
      await workspaceChoice.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined)
      if (await workspaceChoice.isVisible()) {
        await workspaceChoice.click()
        await page.waitForTimeout(250)
      }
      if (await microphoneButton(page).isVisible()) break
    }
    const newWorkspaceSession = page.getByRole('button', { name: 'New session in dsh-speech E2E' })
    if (await newWorkspaceSession.isVisible()) {
      await newWorkspaceSession.click()
      await page.waitForTimeout(250)
      if (await microphoneButton(page).isVisible()) break
      continue
    }
    const workspace = page.getByRole('treeitem', { name: 'dsh-speech E2E' })
    if (await workspace.isVisible()) await workspace.click({ timeout: 500 }).catch(() => undefined)
    if (await microphoneButton(page).isVisible()) break
    await page.waitForTimeout(250)
  }
  await expect(page.locator('[data-slot="conversation.composer"]')).toBeVisible()
  await expect(microphoneButton(page)).toBeVisible()
}

export async function openSpeechSettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Speech' }).click()
  await expect(dialog.getByRole('heading', { name: 'Speech', level: 2 })).toBeVisible()
  return dialog
}

export async function closeSettings(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
}

async function credentialRequest(page: Page, path: string, body?: unknown): Promise<void> {
  const result = await page.evaluate(async ({ requestPath, requestBody }) => {
    const response = await fetch(requestPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody ?? {}),
    })
    return { ok: response.ok, status: response.status, text: await response.text() }
  }, { requestPath: path, requestBody: body })
  if (!result.ok) throw new Error(`Credential request failed (${String(result.status)}): ${result.text}`)
}

export async function disconnectMockCredential(page: Page): Promise<void> {
  await credentialRequest(page, '/api/dsh-speech/auth/logout')
  await page.reload()
  await dismissHarnessFirstRun(page)
  await expect(microphoneButton(page)).toBeVisible()
}

export async function connectMockCredential(page: Page): Promise<void> {
  await credentialRequest(page, '/api/dsh-speech/auth/key', { apiKey: MOCK_API_KEY })
  await page.reload()
  await dismissHarnessFirstRun(page)
  await expect(microphoneButton(page)).toHaveAccessibleName('Start voice input')
}

export async function waitForPartial(page: Page, expected: string): Promise<void> {
  await expect(composerInput(page)).toHaveValue(expected, { timeout: 15_000 })
}

export function expectBoxesDoNotOverlap(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }): void {
  const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  expect(overlapX <= 0 || overlapY <= 0).toBe(true)
}
