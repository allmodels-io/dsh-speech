# @allmodels/dsh-speech

Streaming microphone transcription and spoken answer summaries for the DeepSeek Harness web client, powered by [AllModels.io](https://allmodels.io/).

`@allmodels/dsh-speech` adds a microphone beside Send, live transcription, short spoken versions of completed answers, an AllModels account flow, and a dedicated Speech settings page. It is a standalone Cordis bundle and does not patch DeepSeek Harness.

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
dsh plugin --profile web add ./allmodels-dsh-speech-0.1.2.tgz
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
4. Click Stop to finalize and leave the text as an editable draft, or click the Send arrow to finalize and send in one action. The Send arrow becomes available after speech text first appears.

Existing draft text is preserved and the transcript is appended. Composer editing remains locked while the microphone is active. Stop never sends; the recording Send arrow submits exactly once after finalization.

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

## Spoken summaries

For each newly completed answer, the plugin uses the exact LLM provider/model recorded on that answer to produce concise, plain, speakable prose without an arbitrary word limit. It begins streaming MP3 audio through a compatible AllModels TTS route as soon as validated audio chunks arrive. Answers already present when a session is first opened are not generated automatically, but their **Play summary** control prepares audio on demand.

Text-to-speech summaries and autoplay are enabled by default. Both are global plugin preferences in **Settings → Speech → Spoken summaries**, and autoplay is also available beside the latest spoken-summary player after its first use. Disabling text-to-speech summaries stops playback, cancels pending summary audio, suppresses interaction cues, and hides chat players while preserving the selected model, provider, voice, and autoplay preference.

One browser-global audio player arbitrates all sessions in the current Harness client. A newly prepared summary never interrupts audio already playing and is not queued to start later. Explicitly choosing **Play summary** stops the current summary and plays the selected one. Browser autoplay rejection leaves the waveform ready for a click. This arbitration does not cross browser tabs or windows.

The settings card selects a synchronous MP3 TTS model, a compatible provider, and a discovered voice. A saved compatible choice wins, followed by the provider catalog's advertised default and then the first compatible option.

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
        autoPlay: true
```

`baseURL` is deliberately operator-only; it is not editable in the browser. User STT and TTS choices plus the global autoplay preference are stored through the Harness settings service. Spoken summary text and audio are not stored.

## Privacy and session safety

- Audio is resampled in the browser and relayed through the local plugin host only while recording. It is never written to disk or retained for retry.
- API keys remain host-side in the Harness credential service and are inserted only into authenticated AllModels requests.
- Transcripts remain in the browser's composer draft until the user uses the normal Send arrow or the recording Send arrow.
- The preferred microphone device ID is kept only in plugin-namespaced browser-local storage. It is not written to Harness sessions.
- Spoken summaries and MP3 Blob URLs exist only in browser memory. Pending requests are cancelled and Blob URLs are revoked when their UI or the plugin is disposed.
- Summarization and TTS requests contain prose, locale, and model routing only—never session IDs, message IDs, session paths, or conversation mutation commands.
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
pnpm exec playwright install chromium
pnpm test:e2e
pnpm pack --dry-run
```

`pnpm check` runs the no-session-access boundary, TypeScript, unit/protocol tests, and both production bundles. Tests cover both catalogs, summarizer routing and bounds, TTS response enforcement, history lifecycle, global playback arbitration, UI accessibility, route security, credential redaction, and the AllModels streaming wire mapping.

`pnpm test:e2e` builds and packs the plugin, installs that tarball into a disposable DeepSeek Harness `0.1.1-rc.2` web profile, launches a local AllModels HTTP/WebSocket mock, and runs the Chromium desktop and mobile suite with a generated virtual microphone. It covers first-run account UI, API-key connection, settings layout and persistence, balance/top-up, microphone placement, preparing/recording/finishing states, live partials and finals, waveform motion, composer locking, Stop-without-send, finish-and-send, Cancel, microphone selection, dark-mode menus, and mobile layout. The disposable profile and workspace are created below the operating system's temporary directory; the runner never opens or modifies the user's Harness profile or sessions.

For the optional live smoke test, put the following in a local `.secrets` file (which is gitignored), or export the variables normally:

```dotenv
ALLMODELS_API_KEY=...
DEEPSEEK_API_KEY=...
```

Then run `pnpm test:e2e:live`. The live test checks the environment-managed AllModels account, starts and stops a real streaming STT connection using the virtual microphone, sends a minimal DeepSeek request, and verifies microphone placement in both new-chat and existing-session layouts. It consumes a small amount of API balance. The coordinator removes both credentials from its ambient environment before starting build, package-manager, and Playwright children; only the isolated Harness process receives them. Live Harness output and Playwright traces, screenshots, videos, HTML reports, and artifact uploads are disabled so credentials cannot be reflected into CI diagnostics.

## Release

Every branch push and pull request to `main` runs the static/unit/package gates followed by the deterministic Playwright suite. A push to `main` additionally runs the live browser smoke test with the `ALLMODELS_API_KEY` and `DEEPSEEK_API_KEY` repository secrets. Secrets are never exposed to pull-request jobs.

After all jobs for a `main` push pass, the Release workflow checks out the exact tested commit and publishes its package version to npm with provenance if that version is not already present. It then tags the commit and creates the matching GitHub release. Before enabling this gate, configure both repository secrets and configure `allmodels-io/dsh-speech`'s `release.yml` workflow as the npm trusted publisher for `@allmodels/dsh-speech`. Increment `package.json` before merging a version intended for publication; already-published versions are safely skipped.

## Harness compatibility monitoring

GitHub Actions checks npm once per day for the most recently published stable or `-rc` `@deepseek-ai/dsh` version. Alpha, beta, canary, development, and other prerelease channels are ignored. It exits without installing browsers when the newest eligible version is already tracked in `dsh-compatibility.json`, or when the same version already has an open compatibility issue or update pull request.

For a new version, the workflow updates the Harness peer/development dependency pins in an isolated checkout, installs that dependency set, runs the static and unit gates, packs the plugin into a disposable profile, and runs the desktop/mobile Chromium suite. It never receives the live AllModels or DeepSeek credentials.

- A failure creates one `dsh-compatibility` issue for that Harness version with a link to the failed run. Later daily checks do not duplicate it.
- A pass opens a reviewable pull request updating the tested version, peer dependencies, development dependencies, README, and lockfile. Merging remains manual.
- A manual run can target an explicit stable or `-rc` version or force a retest. Other prerelease channels are rejected by the same release policy used by the daily scheduler. When a forced retest fixes an open compatibility issue, the successful update pull request closes it.

Workflow-created pull requests require the repository’s **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** option. The compatibility workflow requests only the exact `contents`, `pull-requests`, and `issues` write permissions needed by its update job and contains no approval operation.

## License

MIT
