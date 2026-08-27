import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SpeechController } from './controller.ts'
import { SpeechDock, SpeechInputDock, SpeechMic } from './SpeechComposer.tsx'
import { SpeechSettings } from './SpeechSettings.tsx'
import { en, zh } from './locales.ts'
import { STYLE_TEXT } from './styles.ts'
import type { SpeechUserSettings } from '../shared.ts'

export const inject = ['slots', 'locale', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const controller = new SpeechController()
  const scope = ctx.settingsScope.bind<SpeechUserSettings>({ namespace: 'dsh-speech' })
  const getLocale = (): string => ctx.locale.getLocale().active

  ctx.effect(() => ctx.locale.register('speech', { en, zh }), 'dsh-speech: locale dictionaries')
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-speech'
    style.dataset.pluginCss = 'dsh-speech'
    style.textContent = STYLE_TEXT
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-speech: client styles')
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
    const labels = new Set([en.nav, zh.nav])
    const markSpeechNavigation = (): void => {
      for (const button of document.querySelectorAll<HTMLElement>('[role="dialog"] nav button')) {
        const isSpeech = labels.has(button.textContent?.trim() ?? '')
        if (isSpeech) button.dataset.dshSpeechNav = ''
        else delete button.dataset.dshSpeechNav
      }
    }
    const observer = new MutationObserver(markSpeechNavigation)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    markSpeechNavigation()
    return () => {
      observer.disconnect()
      for (const button of document.querySelectorAll<HTMLElement>('[data-dsh-speech-nav]')) delete button.dataset.dshSpeechNav
    }
  }, 'dsh-speech: settings navigation icon')
  ctx.effect(() => () => { controller.dispose() }, 'dsh-speech: browser controller')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'speech',
    order: 30,
    label: () => ctx.locale.bind('speech')('nav'),
    locale: 'speech',
    inject: () => ({ controller, scope, getLocale }),
  }, SpeechSettings))

  ctx.inject(['conversation'], scoped => {
    const blocks = scoped.conversation.blocks
    controller.attachBlocks(blocks)
    const mic = scoped.slots.register({
      name: 'conversation.input.right',
      id: 'speech-microphone',
      order: 100,
      locale: 'speech',
      inject: () => ({ controller, getLocale }),
    }, SpeechMic)
    const dock = scoped.slots.register({
      name: 'conversation.composer.dock',
      id: 'speech-amplitude',
      order: 100,
      locale: 'speech',
      inject: () => ({ controller, getLocale }),
    }, SpeechDock)
    const inputDock = scoped.slots.register({
      name: 'conversation.input.dock',
      id: 'speech-microphone-selector',
      order: 100,
      locale: 'speech',
      inject: () => ({ controller, getLocale }),
    }, SpeechInputDock)
    return () => {
      controller.detachBlocks(blocks)
      mic()
      dock()
      inputDock()
    }
  })
}
