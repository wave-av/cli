# @wave-av/cli

Command-line interface for the WAVE streaming platform. Manage streams, productions, and infrastructure from your terminal.

## Installation

```bash
# npm
npm install -g @wave-av/cli

# pnpm
pnpm add -g @wave-av/cli

# npx (one-off usage)
npx @wave-av/cli stream list
```

## Quick start

```bash
# Authenticate
wave login

# Create a stream
wave stream create --title "My Stream" --protocol webrtc

# List your streams
wave stream list

# Start streaming
wave stream start <stream-id>
```

## Authentication

### OAuth device flow (recommended)

```bash
wave login
# Opens browser for authentication
```

### Direct API key

```bash
wave login --api-key wave_live_your_key_here
```

### Multi-project context

```bash
# Separate environments
wave login --project-name production
wave login --project-name staging

# Switch context
wave config set currentProject staging

# Override per-command
wave stream list --project production
```

### CI/CD environment variables

```bash
export WAVE_API_KEY=wave_live_your_key_here
export WAVE_ORG_ID=org_123
wave stream list  # Uses env vars automatically
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
| `transcribe`   | Transcription           | `wave transcribe create --stream-id <id>`  |
| `sentiment`    | Sentiment analysis      | `wave sentiment analyze --text "..."`      |
| `search`       | Content search          | `wave search query --q "keyword"`          |
| `scene`        | Scene detection         | `wave scene detect --recording-id <id>`    |
| `fleet`        | Device management       | `wave fleet list`                          |
| `ghost`        | AI director             | `wave ghost suggestions`                   |
| `mesh`         | Multi-region            | `wave mesh status`                         |
| `edge`         | Edge processing         | `wave edge cache status`                   |
| `analytics`    | Streaming analytics     | `wave analytics viewers`                   |
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
| `wave listen`          | Forward webhook events to localhost    |
| `wave logs tail`       | Real-time API log streaming            |
| `wave trigger <event>` | Fire test webhook events               |
| `wave dev`             | Combined listen + logs for development |
| `wave open [page]`     | Open WAVE dashboard in browser         |
| `wave init [name]`     | Scaffold a new project from templates  |

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
| `WAVE_BASE_URL`       | Override API base URL             |
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

MIT
