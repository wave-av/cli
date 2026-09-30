# @wave-av/cli

WAVE is media infrastructure for the agentic internet: one call shape moves live and on-demand media across every transport, and both kinds of user, people and agents, discover it, call it, and pay for it per call. This CLI is the terminal client for that call shape. Manage streams, productions, and infrastructure from your terminal, by hand or from an agent's script.

## Installation

```bash
# npm
npm install -g @wave-av/cli

# pnpm
pnpm add -g @wave-av/cli

# npx (one-off usage)
npx @wave-av/cli status
```

## Quick start

```bash
# Authenticate (`wave login` is an alias)
wave auth login

# Who am I, and which organization does this key act for?
wave whoami

# Plan and billed usage
wave billing status
wave billing usage

# Account analytics
wave analytics overview
```

## Authentication

Every command resolves credentials the same way: `WAVE_API_KEY` first, then the key
`wave auth login` stored for the current project. Requests go to `https://api.wave.online`
unless `WAVE_BASE_URL` (or the project's saved `baseUrl`) says otherwise.

### Device flow (recommended)

```bash
wave auth login
# Prints a code and opens your browser to approve it (--no-browser to only print the URL)
```

### Direct API key

```bash
wave auth login --api-key wave_live_your_key_here
```

Keys are stored in the OS keychain. Where no keychain is available (headless Linux without
libsecret, containers), or with `WAVE_CREDENTIAL_STORE=file`, they go to
`~/.wave/credentials.json` with mode `0600`.

### Multi-project context

```bash
# Separate environments
wave auth login --project production --api-key wave_live_...
wave auth login --project staging --api-key wave_live_...

# Switch context
wave config set currentProject staging

# Override per-command
wave billing status --project production
```

### CI/CD environment variables

```bash
export WAVE_API_KEY=wave_live_your_key_here
wave whoami  # Uses env vars automatically; no login or saved project needed
```

## Command groups

| Group          | Description             | Example                                    |
| -------------- | ----------------------- | ------------------------------------------ |
| `stream`       | Live stream management  | `wave stream create --title "Live"`        |
| `studio`       | Multi-camera production | `wave studio start <id>`                   |
| `clip`         | Stream clips            | `wave clip create --stream-id <id>`        |
| `editor`       | Video editor            | `wave editor render <id>`                  |
| `voice`        | Voice synthesis         | `wave voice synthesize --text "Hello"`     |
| `phone`        | Telephony               | `wave phone call --to +1234567890`         |
| `collab`       | Collaboration rooms     | `wave collab room create`                  |
| `captions`     | Live captions           | `wave captions generate --stream-id <id>`  |
| `chapters`     | Chapter detection       | `wave chapters detect --recording-id <id>` |
| `ai`           | AI assistant            | `wave ai assistant start`                  |
| `compose`      | Composition proposals   | `wave compose "live captions for tomorrow's webinar"` |
| `transcribe`   | Transcription           | `wave transcribe create --stream-id <id>`  |
| `sentiment`    | Sentiment analysis      | `wave sentiment analyze --text "..."`      |
| `search`       | Content search          | `wave search query --q "keyword"`          |
| `scene`        | Scene detection         | `wave scene detect --recording-id <id>`    |
| `fleet`        | Device management       | `wave fleet list`                          |
| `ghost`        | AI director             | `wave ghost suggestions`                   |
| `mesh`         | Multi-region            | `wave mesh status`                         |
| `edge`         | Edge processing         | `wave edge cache status`                   |
| `analytics`    | Streaming analytics     | `wave analytics overview`                  |
| `prism`        | Camera discovery        | `wave prism discover`                      |
| `zoom`         | Zoom integration        | `wave zoom meeting create`                 |
| `vault`        | Recording archive       | `wave vault recordings list`               |
| `marketplace`  | Plugin marketplace      | `wave marketplace search`                  |
| `connect`      | Integrations            | `wave connect integrations`                |
| `distribution` | Simulcast               | `wave distribution simulcast`              |
| `desktop`      | Desktop nodes           | `wave desktop nodes`                       |
| `signage`      | Digital signage         | `wave signage displays list`               |
| `qr`           | QR codes                | `wave qr create --data "https://..."`      |
| `audience`     | Engagement              | `wave audience polls create`               |
| `creator`      | Monetization            | `wave creator revenue`                     |
| `podcast`      | Podcast management      | `wave podcast episodes list`               |
| `slides`       | Presentations           | `wave slides convert`                      |
| `usb`          | USB devices             | `wave usb devices list`                    |
| `notify`       | Notifications           | `wave notify send --to user@example.com`   |
| `drm`          | Content protection      | `wave drm licenses list`                   |
| `billing`      | Billing & usage         | `wave billing status`                      |

## Developer tools

| Command                | Description                            |
| ---------------------- | -------------------------------------- |
| `wave doctor`          | Diagnose install, auth, and API reach  |
| `wave api <m> <path>`  | Call any API route with your key       |
| `wave webhook-subscriptions list` | Your org's platform event subscriptions |
| `wave open [page]`     | Open WAVE dashboard in browser         |
| `wave init [name]`     | Scaffold a new project from templates  |

`wave listen`, `wave logs tail`, `wave trigger` and `wave dev` are registered but not yet
served by the WAVE API: they exit with code 11 (not implemented) and a notice, without
sending anything. Any command whose route the API does not serve yet (`ROUTE_NOT_FOUND` /
`ROUTE_NOT_MAPPED`) exits the same way instead of reporting a plain 404.

## Global flags

| Flag                    | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `-o, --output <format>` | Output format: `table` (default), `json`, `yaml` |
| `--project <name>`      | Override project context                         |
| `--org <id>`            | Override organization                            |
| `-c, --confirm`         | Skip confirmation prompts (for scripting)        |
| `--no-color`            | Disable colored output                           |
| `--debug`               | Verbose debug logging                            |

## Environment variables

| Variable              | Description                       |
| --------------------- | --------------------------------- |
| `WAVE_API_KEY`        | Override API key (skips keychain) |
| `WAVE_ORG_ID`         | Override organization ID          |
| `WAVE_PROJECT`        | Override project name             |
| `WAVE_OUTPUT_FORMAT`  | Override output format            |
| `WAVE_BASE_URL`       | Override API base URL (default `https://api.wave.online`) |
| `WAVE_CREDENTIAL_STORE=file` | Store credentials in `~/.wave/credentials.json` instead of the OS keychain |
| `WAVE_KEYCHAIN_TIMEOUT_MS` | How long to wait on a locked OS keychain before failing (default 60000) |
| `WAVE_NO_COLOR=1`     | Disable colors                    |
| `WAVE_NO_TELEMETRY=1` | Disable telemetry                 |

## Shell completions

```bash
# Bash
wave completion bash > ~/.bashrc.d/wave
source ~/.bashrc.d/wave

# Zsh
wave completion zsh > ~/.zsh/completions/_wave

# Fish
wave completion fish > ~/.config/fish/completions/wave.fish
```

## CI/CD example

```yaml
# .github/workflows/deploy-stream.yml
name: Deploy Live Stream
on: workflow_dispatch
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: npm install -g @wave-av/cli
      - run: wave stream create --title "Auto Stream" --protocol webrtc --confirm --output json
        env:
          WAVE_API_KEY: ${{ secrets.WAVE_API_KEY }}
```

## Related packages

- [@wave-av/sdk](https://www.npmjs.com/package/@wave-av/sdk) — TypeScript SDK (34 API modules)
- [@wave-av/adk](https://www.npmjs.com/package/@wave-av/adk) — Agent Developer Kit
- [@wave-av/mcp-server](https://www.npmjs.com/package/@wave-av/mcp-server) — MCP server for AI tools
- [@wave-av/create-app](https://www.npmjs.com/package/@wave-av/create-app) — Scaffold a new project
- [@wave-av/workflow-sdk](https://www.npmjs.com/package/@wave-av/workflow-sdk) — Workflow orchestration

## License

Apache-2.0 — see [LICENSE](LICENSE). The [NOTICE](NOTICE) file reserves the WAVE
trademarks; the Apache License grants rights to the software only.
