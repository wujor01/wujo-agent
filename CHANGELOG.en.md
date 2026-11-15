# Changelog

Every notable change to WujoAgent is recorded here. Vietnamese version: `CHANGELOG.md`. The two files must stay in step; agent.wujo.dev/en/changelog is built from them.

## [1.0.1] - 2026-11-15

### Changed

- The QR code now points to `agent.wujo.dev/add`: scanning it with the iPhone camera opens the installed app directly. Without the app, that page offers to open the app or use the web version on your own computer.
- The token and computer addresses still sit after the `#` in the link, so they are never sent to `agent.wujo.dev`.

### Added

- The app picks Vietnamese or English from the device language; error messages from the computer follow the same language.
- A `..` row at the top of folder lists to go up to the parent folder.
- **Auto** permission mode: Claude approves safe actions itself and asks only when unsure.

### Fixed

- The diff view reported "file is outside this repo" when the folder was written with a Windows 8.3 short name.

## [1.0.0] - 2026-11-15

First release.

### Server on your computer

- `wujoagent serve` runs a small server on the machine that has Claude Code; your phone connects straight to it over your local network or Tailscale.
- Each turn runs through the Claude Agent SDK and asks permission for every action, as in VS Code: allow once, always allow, or deny.
- Reads the Claude Code sessions already in each project folder, including ones started in VS Code or a terminal, and lets you continue them.
- Git view: branch, ahead and behind counts, changed files with added and removed lines, per-file diff; fetch, pull (fast-forward only), push.
- Prints a QR code for adding the computer to the app; `wujoagent qr` prints it again.
- Every API call needs a token; more than ten wrong guesses in a minute blocks that address for a while.

### Phone app

- Add a computer by scanning a QR code or typing its IP, port and token.
- Pick a root folder, see projects with their session counts, sort by activity, modified date or name.
- Chat shows the answer as it streams, permission cards, and a Stop button.
- Choose model and permission mode per session.
- Type `/` to see the project's commands and skills.
- Settings sheet: context percentage, 5-hour and 7-day limits, MCP server status.
- See which files a session changed and the diff of each one.
- Runs on iOS, Android and in the browser.
