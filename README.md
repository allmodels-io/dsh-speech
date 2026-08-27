# @allmodels/dsh-speech

Streaming microphone transcription for the DeepSeek Harness web client, powered by [AllModels.io](https://allmodels.io/).

`@allmodels/dsh-speech` adds a microphone beside Send, a live amplitude bar below the composer, partial and final transcription, an AllModels account flow, and a dedicated Speech settings page. It is a standalone Cordis bundle and does not patch DeepSeek Harness.

## Compatibility

- DeepSeek Harness web profile `0.1.1-rc.2`
- Node.js `^22.19.0 || >=24.0.0`
- A browser with `getUserMedia`, `AudioContext`, and `AudioWorklet`
- Loopback-hosted Harness web UI

The Harness extension surface is currently prerelease, so this package pins its Harness peer dependencies to the tested release.

## Install

From npm after publication:

```sh
dsh plugin --profile web add @allmodels/dsh-speech
```

From this checkout:

```sh
pnpm install
pnpm build
dsh plugin --profile web add .
```

Or create a portable tarball:

```sh
pnpm pack
dsh plugin --profile web add ./allmodels-dsh-speech-0.1.0.tgz
```

Restart the profile after adding or removing the bundle.

## Connect AllModels

Open **Settings → Speech** and choose either:

1. Enter an email address, request the six-digit code, and verify it. This is the AllModels agentic signup/login flow and works for both new and existing accounts.
2. Paste an existing AllModels API key.

The key is sent to the local plugin host once and stored through the Harness credential service. It is never returned to the browser. You can also provide `ALLMODELS_API_KEY` in the Harness environment; an environment-managed key is read-only in the settings UI.

See the [AllModels agentic setup documentation](https://docs.allmodels.io/agentic-setup) for account details.

## Use voice input

1. Click the microphone next to Send.
2. Speak while the amplitude bar and partial transcription update.
3. While recording, choose **System default** or another input from the microphone selector beside TTFT. On a new chat, the selector appears beside the mode selector in the hero controls row.
4. Click Stop. The plugin waits briefly for the last final transcript, unlocks the composer, and leaves the text as an editable draft.

Voice input never sends the message automatically. Existing draft text is preserved and the transcript is appended. Composer editing and Send are disabled while the microphone is active.

Only one microphone may be active at a time. Leaving the originating session immediately stops capture, closes the speech socket, clears the transient composer lock, and preserves the latest draft text.

A specifically selected microphone is remembered for this browser and reused on the next recording. Choosing **System default** clears that preference. If a remembered device is no longer available, capture safely falls back to the current system default.

The microphone selector is hidden on mobile layouts, where the browser's system-default input or previously remembered device is used automatically.

## Recognition settings

- **Model**, then **provider**: populated from the live AllModels provider catalog. Only streaming bindings accepting mono PCM16 at 16 kHz are shown.
- **Default model**: a Chinese Harness locale uses Soniox's current advertised streaming default; other locales use AssemblyAI's current advertised streaming default. An explicit saved choice always wins.
- **Language**: Auto, a common language code, or a custom BCP-47 tag such as `zh-CN`.
- **Context**: sent only when the selected binding advertises context support. A saved value remains intact when switching to a provider that does not support it.
- **Balance**: paid plus eligible, unexpired promotional funds applicable to the selected binding. A warning appears below $0.50; a known zero balance disables recording.
- **Top-up**: creates an AllModels-hosted checkout link for $5–$1,000. The default amount is $10.

Model and streaming details come from the [AllModels provider catalog](https://docs.allmodels.io/models) and [native streaming STT API](https://docs.allmodels.io/api-reference/native-tts/stt/nativeSttStream).

## Operator configuration

The bundle row may be given composition-level defaults in a Harness patch:

```yaml
- insert:
    - id: ui-speech
      name: '@allmodels/dsh-speech'
      config:
        apiKeyEnv: ALLMODELS_API_KEY
        baseURL: https://api.allmodels.io
        lowBalanceUsd: 0.5
        defaultTopUpUsd: 10
```

`baseURL` is deliberately operator-only; it is not editable in the browser. User model, provider, language, and context overrides are stored through the Harness settings service and take effect on the next recording.

## Privacy and session safety

- Audio is resampled in the browser and relayed through the local plugin host only while recording. It is never written to disk or retained for retry.
- API keys remain host-side in the Harness credential service and are inserted only into authenticated AllModels requests.
- Transcripts exist only in the browser's existing unsent composer draft until the user sends them normally.
- The preferred microphone device ID is kept only in plugin-namespaced browser-local storage. It is not written to Harness sessions.
- The host plugin does not inject Harness session services, import session packages, read session files, or write session files. A build check fails if a session/filesystem persistence dependency is introduced.
- The plugin's custom HTTP and WebSocket routes accept only same-origin loopback requests and enforce bounded request/frame sizes.

The only durable plugin data is its namespaced settings, credential, and browser-local microphone preference. See the [AllModels balance](https://docs.allmodels.io/api-reference/account/getAccountBalance) and [top-up](https://docs.allmodels.io/api-reference/account/createAccountTopUpLink) documentation for account-side data.

## Troubleshooting

- **Microphone is disabled:** connect AllModels in Settings → Speech and confirm the usable balance is not zero.
- **Browser denied the microphone:** grant microphone permission to the local Harness page, then retry.
- **No models appear:** use Refresh in Speech settings. The catalog keeps a five-minute in-memory cache and falls back to its last successful value during that process lifetime.
- **Context is disabled:** the chosen provider/model binding does not advertise the portable `context` option.
- **Environment key cannot be disconnected:** remove or change `ALLMODELS_API_KEY` in the Harness environment; read-only sources cannot be overwritten from the UI.
- **Balance cannot be fetched:** recording remains enabled unless the last known balance is exactly zero. Provider-side insufficient-balance errors stop safely and preserve the draft.

## Development

```sh
pnpm install
pnpm check
pnpm pack --dry-run
```

`pnpm check` runs the no-session-access boundary, TypeScript, unit/protocol tests, and both production bundles. Tests cover catalog defaults, provider capabilities, targeted promotional balances, transcript sequencing/CJK spacing, route security, credential redaction behavior, and the AllModels streaming wire mapping.

## Release

Pull requests run the full check and package dry run. A `v*` GitHub release tag runs the same gates and publishes with npm provenance after the package owner configures this repository as an npm trusted publisher.

## License

MIT
