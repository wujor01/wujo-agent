# WujoAgent

**English** · [Tiếng Việt](README.vi.md)

Manage and chat with the Claude Code sessions on your computer from your phone, over a LAN IP or Tailscale, without Claude Remote Control: reopen sessions, send work, approve each tool call, review git changes file by file. The phone talks straight to a small server on your own machine; there is no relay. Website and install guide: [agent.wujo.dev](https://agent.wujo.dev/en/).

WujoAgent is an independent project, not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.

- `server/` — the Node server that runs on the machine with Claude Code (command `wujoagent`, short `wa`). It runs each chat turn with the Claude Agent SDK, asks permission for each tool as VS Code does, reads the existing sessions of each workspace, and shows git with fetch / pull / push.
- `app/` — the iOS/Android app (Expo). The same source exports a web build, which the server serves itself.
- `landing/` — the website and privacy policy (vi/en).
- `deploy/cloudflare/` — the worker and config that put the landing page on Cloudflare.
- `docs/release.md` — release steps for the App Store, the APK, the landing deploy, CI/CD and store text (in Vietnamese).
- `CHANGELOG.md`, `CHANGELOG.en.md` — the changelog; agent.wujo.dev/changelog is built from these two files.
- `README.md`, `README.vi.md` — this document in English and Vietnamese; change one, change the other.
- `.github/workflows/` — automated checks, landing deploy, server release, app builds.

The data folder is still `~/.claude-sessions` (the project's old name) so existing sessions are not lost.

## Install (on the machine with Claude Code)

You need Node 20 or later and to be signed in to `claude`.

The latest release:

```bash
npm install -g https://github.com/wujor01/wujo-agent/releases/latest/download/wujoagent.tgz
```

The `wa` command and the server speak English by default. For Vietnamese, add `--wa-lang=vi` when installing:

```bash
npm install -g https://github.com/wujor01/wujo-agent/releases/latest/download/wujoagent.tgz --wa-lang=vi
```

To change it after installing: `wa lang vi` or `wa lang en` (a running server follows from the next `wa serve`). The `WA_LANG=vi|en` environment variable overrides both. `wa update` keeps the language you chose. The language of the phone app is set separately, in the app.

Or from source:

```bash
cd server
npm install
npm link
```

Both ways create the `wujoagent` command and its short name `wa`. If you would rather not link, replace `wa` with `node bin/wujoagent.js`.

## Run the server

```bash
wa serve
```

The server prints the token and the addresses to enter in the app, for example:

```
WujoAgent is running on 0.0.0.0:7433
Token: abcd2345efgh
  Tailscale  http://100.64.0.10:7433
  LAN        http://192.168.1.10:7433
```

If the phone cannot connect, Windows Firewall may be blocking the port. Open it for private networks from an admin PowerShell (you run this yourself):

```powershell
New-NetFirewallRule -DisplayName "claude-sessions" -Direction Inbound -Protocol TCP -LocalPort 7433 -Action Allow -Profile Private
```

To listen on Tailscale only: `wa serve --host 100.64.0.10`.

To have the server start by itself whenever you sign in to the computer:

```bash
wa startup on
```

- `wa startup on --code [folder]` also starts VS Code for the web (run `wa code` by hand once first, so its license question has been answered).
- `wa startup` shows whether it is on; `wa startup off` removes it. Neither starts or stops anything that is running now.
- It uses your own account's start-up mechanism, with no administrator rights: a script in the Startup folder on Windows, a LaunchAgent on macOS, an autostart entry on Linux. Output goes to `startup-serve.log` and `startup-code.log` in the data folder.
- The server starts after you sign in, not at boot: a machine sitting at the login screen is not reachable yet.

## Use it on the phone

There are three ways, from quickest to most complete:

1. **Browser** — open `http://<IP>:7433` in Safari/Chrome. On iPhone tap Share → Add to Home Screen to get an app-like icon. A release install already includes the web build; from source, build it once:

   ```bash
   cd app
   npm install
   npx expo export -p web --output-dir ../server/web
   ```

2. **Expo Go** — install Expo Go on the phone, then on the computer:

   ```bash
   cd app
   npx expo start
   ```

   Scan the QR code. The phone and the computer must be on the same network (or the same tailnet).

3. **Installed app** — needs an Expo account; iOS also needs an Apple Developer account. Change `bundleIdentifier` and `package` in `app/app.json` first.

   ```bash
   cd app
   npx eas-cli build --platform android --profile preview
   ```

   ```bash
   npx eas-cli build --platform ios
   ```

**Add a server with a QR code.** `wa serve` prints a QR code for each address (Tailscale, LAN); `wa qr` prints them again at any time. In the app tap **Scan QR**, or scan the code with the phone's camera: the camera opens the web build and the server is added at once. The QR code contains the token, so do not let anyone else photograph it.

In the app: **Add server** (scan the QR code, or enter IP, port and token) → **Choose root folder** (for example `E:\work\repos`) → the app lists the workspaces inside it and how many sessions each has → open a workspace to reopen an old session or start a new one.

- Sessions created from VS Code, the terminal or the desktop app all show up and can be continued.
- A workspace that is a git repo gets a git panel: branch, commits ahead of and behind upstream, changed files, recent commits, and Fetch / Pull / Push buttons. Pull only fast-forwards. To commit or switch branches, ask Claude in the chat.
- Tap a file in the git panel to see its changes against the latest commit.
- In the chat screen, the **± N files** button at the top lists the files that session has edited; tap one to see its changes.
- The **⚙** button at the top right opens the session settings: model, permission mode, usage (context, 5-hour and 7-day limits), MCP servers.
- Type `/` in the input box for the workspace's command suggestions (including skills and the project's own commands). `/mcp`, `/usage` and `/status` open the settings panel; `/model` opens the model picker.
- The permission mode and model can also be changed on the line above the input box.
- Send a message while Claude is working: it goes straight into the running turn and Claude reads it at its next step, without waiting for the turn to end.
- Long-press a session to remove it from the app; Claude's history on the server is not deleted.

## VS Code in the browser

When a phone-sized chat is not enough (a tablet, or another laptop), `wa code` runs VS Code for the web on the computer, with the Claude Code extension, so the browser shows the same Claude sessions as VS Code on that machine. VS Code must already be installed there, with its `code` command on the PATH.

```bash
wa code E:\work\repos\my-project
```

- The first run downloads VS Code Server and asks you to accept its license terms in the terminal; `--accept-license` answers yes for you. `wa code` then installs the Claude Code extension for the web build.
- VS Code for the web listens on `127.0.0.1:8765` only and needs its own token, which is in the address that `wa code` prints.
- From another device, go through Tailscale with HTTPS: run `wa code --tailscale` (it runs `tailscale serve --bg --https=8443 http://127.0.0.1:8765`), then open the `https://<machine>.<tailnet>.ts.net:8443/...` address it prints, or scan its QR code. This is tailnet-only, not the internet; turn it off with `tailscale serve --https=8443 off`. A plain `http://<IP>` address does not work, because the Claude panel only runs on HTTPS or localhost. Your tailnet needs MagicDNS and HTTPS certificates enabled.
- A folder opened for the first time is in Restricted Mode: click the badge at the bottom left and choose Trust, then click the Claude icon in the left bar to see the sessions.
- Options: `--port N`, `--https-port N`, `--no-qr`.

Whoever has that address and token gets a terminal and every file on the machine with your permissions, not just a chat with per-tool approval as in the app. Keep it inside your tailnet and never use `tailscale funnel` for it.

## Use it over SSH

`wa` talks to the server running on that same machine, so it works once you SSH in:

```bash
ssh my-server wa list
```

| Command | What it does |
|---|---|
| `wa serve [--port N] [--host IP]` | run the server |
| `wa version` | print the installed version and the latest one |
| `wa update` | install the latest version; then run `wa serve` again |
| `wa lang [vi\|en]` | print or set the language of the `wa` command and the server |
| `wa token` | print the token |
| `wa token --reset` | issue a new token; the old one stops working at once and every device must add the server again |
| `wa qr [tailscale\|lan\|IP]` | print a QR code to add the server |
| `wa code [folder] [--tailscale]` | run VS Code for the web with Claude Code (see below) |
| `wa startup [on\|off] [--code [folder]]` | start the server (and VS Code for the web) when you sign in |
| `wa list` | list the sessions opened through WujoAgent |
| `wa new <folder> [title]` | create a session |
| `wa send <id> <message>` | send a message, watch the reply, answer permission requests with `y` / `a` / `n` |
| `wa show <id>` | show the history |
| `wa git <id> [fetch\|pull\|push]` | show the repo or run a git operation |
| `wa rm <id>` | remove a session |

If you would rather not open a port to the network, run `wa serve --host 127.0.0.1` and use an SSH tunnel from the other machine:

```bash
ssh -L 7433:127.0.0.1:7433 my-server
```

## Configuration

Data lives in `~/.claude-sessions` (`config.json`, `sessions.json`, `events/`). Environment variables override the config file.

| Variable | Meaning | Default |
|---|---|---|
| `CS_PORT` | port | 7433 |
| `CS_HOST` | listen address | 0.0.0.0 |
| `CS_TOKEN` | token | generated at random on first run |
| `CS_DATA_DIR` | data folder | `~/.claude-sessions` |
| `WA_LANG` | language of the `wa` command and the server, `vi` or `en` | `en`, or what was chosen at install or with `wa lang` |
| `WA_NO_UPDATE_CHECK` | set to `1` to stop the server asking GitHub about new versions | (it asks, once every 6 hours) |
| `CS_CLAUDE_PATH` | path to `claude` if the SDK cannot find it | (found automatically) |

## Security

- Every API call needs the token; after more than 10 wrong tokens in a minute, that IP is locked out for a minute.
- The connection is plain HTTP. Over Tailscale it is already encrypted; on a LAN the token travels in clear text, so use it only on a network you trust.
- Anyone with the token can control Claude Code on this machine with your permissions. Do not open the port to the internet.
- There is no mode that skips permission prompts.
- If you think the token leaked, change it at once: `wa token --reset`, or the **Change token** button under ⚙ in the app. It cannot be changed this way when the token is set with the `CS_TOKEN` variable.

## Tests

```bash
cd server
npm test
```

Real runs against Claude (they use a few tokens):

```bash
node scripts/smoke.mjs
```

```bash
node scripts/smoke-inject.mjs
```

```bash
cd app
npx tsc --noEmit
```

## License

MIT, see [LICENSE](LICENSE).
