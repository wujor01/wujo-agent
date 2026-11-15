# Changelog

Every notable change to WujoAgent is recorded here. Vietnamese version: `CHANGELOG.md`. The two files must stay in step; agent.wujo.dev/en/changelog is built from them.

## [1.0.6] - 2026-11-15

### Changed

- A message sent while Claude is working no longer waits for the turn to end: it goes straight into the running turn and Claude reads it at its next step (right after the current tool finishes), so a change of mind takes effect at once. The message stays in the waiting row until Claude has actually received it, then becomes a row in the history. If the turn is stopped before the message arrives, it is sent as the next turn.

### Added

- Change the token: the **Change token** button under ⚙ → Server, or the `wa token --reset` command. The old token stops working at once, with no server restart; the device that pressed the button gets the new token automatically, while other devices must scan the QR code again and stop receiving push notifications.

## [1.0.5] - 2026-11-15

### Added

- The server tells you when an update is out: `wa serve` prints a one-line reminder, and `wa version` shows the installed and latest versions.
- `wa update` installs the latest version. The server never updates or restarts itself; after updating, run `wa serve` again.
- The app shows the server version under ⚙ and warns when the server on your computer is older than the app needs.
- Turn the update check off with the environment variable `WA_NO_UPDATE_CHECK=1`.

## [1.0.4] - 2026-11-15

### Added

- You can see what Claude is thinking: a summary of its thinking streams in while it works, and stays in the history as a "Thinking" row you tap to expand.

## [1.0.3] - 2026-11-15

### Changed

- You can send messages while Claude is working: they are queued and sent as the next turn when the current one ends. Tapping Stop sends the queued messages right away. The queue can be cancelled.
- The chat shows what Claude is doing (thinking, writing, which tool is running) and how long the turn has been going.
- Opening the keyboard no longer pushes the end of the conversation out of view; if you scrolled up to read, the list no longer jumps back to the end.

## [1.0.2] - 2026-11-15

### Changed

- With a session open on the phone, continuing it on the computer (VS Code, terminal) now shows up on the phone after a few seconds, without leaving and reopening. Only completed messages appear, not text still being typed.
- The permission card is now a popup in the middle of the screen instead of a row in the chat; it can be minimised to read the conversation before deciding.

### Fixed

- The app froze on iPhone after opening a file from the "files changed by this session" list.
- The slash-command suggestions were covered by the "Mode" line.
- The Android build failed after Vietnamese permission texts were added for iOS.

## [1.0.1] - 2026-11-15

### Changed

- The QR code now points to `agent.wujo.dev/add`: scanning it with the iPhone camera opens the installed app directly. Without the app, that page offers to open the app or use the web version on your own computer.
- The token and computer addresses still sit after the `#` in the link, so they are never sent to `agent.wujo.dev`.

### Added

- The app picks Vietnamese or English from the device language; error messages from the computer follow the same language.
- A `..` row at the top of folder lists to go up to the parent folder.
- Push notifications (optional, off by default): get notified when Claude finishes or needs approval while the app does not have that session open. A notification shows only the project folder name. Needs the app from TestFlight or the APK; iPhone only for now.
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
