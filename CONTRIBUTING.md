# Contributing

## Local development

```sh
pnpm install
pnpm build
dsh plugin --profile web add .
```

Run the validation suite and browser tests before submitting a change:

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm pack --dry-run
```

`pnpm check` runs the session-access boundary check, TypeScript, unit and protocol tests, and both production bundles.

`pnpm test:e2e` builds and packs the plugin, installs it into a disposable DeepSeek Harness web profile, launches a local AllModels mock, and runs the Chromium desktop and mobile suite. The disposable profile and workspace are created below the operating system's temporary directory; the runner does not modify the user's Harness profile or sessions.

## Live smoke test

Put the following values in a local `.secrets` file, which is gitignored, or export them normally:

```dotenv
ALLMODELS_API_KEY=...
DEEPSEEK_API_KEY=...
```

Then run:

```sh
pnpm test:e2e:live
```

The live test checks the AllModels account, opens a real streaming transcription connection using the virtual microphone, sends a minimal DeepSeek request, and verifies microphone placement. It consumes a small amount of API balance.

## Operator configuration

Composition-level defaults can be supplied in a Harness patch:

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

`baseURL` is operator-only. User speech settings are stored through the Harness settings service.

## Privacy and session boundaries

- Audio is relayed only while recording and is never written to disk.
- API keys remain host-side in the Harness credential service.
- Transcripts remain in the browser composer until the user sends them.
- Summary audio exists only in browser memory. Summary text may be cached locally for up to 30 days and can be cleared from Settings.
- Summarization and TTS requests do not include session IDs, message IDs, session paths, or conversation mutation commands.
- The plugin does not read or write Harness session files.

## Release

Every branch push and pull request to `main` runs the static, unit, package, and deterministic browser gates. A push to `main` additionally runs the live browser smoke test with repository secrets.

After all jobs for a `main` push pass, the Release workflow publishes the package version to npm with provenance if it is not already present, then tags the commit and creates the matching GitHub release. Increment `package.json` before merging a version intended for publication.

Configure `allmodels-io/dsh-speech`'s `release.yml` workflow as the npm trusted publisher. The repository also needs `ALLMODELS_API_KEY` and `DEEPSEEK_API_KEY` secrets for the live smoke test.

## Harness compatibility monitoring

GitHub Actions checks npm daily for the newest stable or release-candidate `@deepseek-ai/dsh` version. Other prerelease channels are ignored.

For a new version, the workflow updates Harness dependency pins in an isolated checkout, runs the static and unit gates, packs the plugin into a disposable profile, and runs the desktop and mobile browser suite.

- A failure creates one `dsh-compatibility` issue for that Harness version.
- A pass opens a pull request updating the tested version, dependencies, README, and lockfile.
- A manual run can target an explicit stable or release-candidate version or force a retest.

Workflow-created pull requests require **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**. The workflow requests only the `contents`, `pull-requests`, and `issues` write permissions used by its update job.
