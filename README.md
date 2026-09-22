# AXEIS IDE

A browser-based Python IDE for the AXEIS ESP32 robot. Write Python in the
editor, hit Run, and it executes on the robot over USB while stdout and stderr
stream back into the console panel.

No backend, no accounts, no database, no wifi. It is a static page that talks to
the board through the browser's Web Serial API.

## Requirements

- **Chrome or Edge** (any Chromium browser, version 89+). Web Serial does not
  exist in Firefox or Safari, and the IDE refuses to load there.
- **Node 20+** to build or run it locally.
- An ESP32 already flashed with MicroPython, plugged in over USB.

Flashing MicroPython is out of scope for this repo. Follow the official guide:
<https://docs.micropython.org/en/latest/esp32/tutorial/intro.html>

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # typechecks, then emits dist/
npm run preview  # serve dist/ locally
```

`npm run typecheck` runs `tsc --noEmit` on its own.

## Using it

1. Plug in the robot and click **Connect**, then pick the serial device. The
   status dot turns green.
2. Write Python in the editor.
3. **Run** (or Ctrl-Enter / Cmd-Enter) executes the editor contents on the robot.
4. **Stop** sends Ctrl-C and interrupts the running program.
5. **Download** saves the editor contents to your laptop as a `.py` file.
   **Upload** loads a `.py` file back into the editor — it never runs it for you.
6. **Disconnect** returns the board to the friendly REPL, so `mpremote` or
   Thonny can pick it up straight afterwards.

### What v1 does not do

Run executes code **in RAM**. Nothing is written to the board's flash, so
nothing survives a power cycle. There is no file management on the robot, no
multi-file projects, and no autosave. This is deliberate for v1.

## How it talks to the robot

`src/repl.ts` is the only module that knows about MicroPython control bytes. It
uses the **raw REPL** (Ctrl-A), not paste mode, because raw REPL frames every
response identically and can be parsed without guessing:

```
submit:   <code bytes> 0x04
response: "OK" <stdout> 0x04 <stderr> 0x04 ">"
```

Output is streamed to the UI as bytes arrive rather than buffered until the
program ends, so a program that prints for ten minutes shows output for ten
minutes. The console caps at 10,000 lines and drops from the top beyond that.

Port settings are 115200 baud, 8N1, no flow control.

## Layout

```
index.html          the IDE page
src/main.ts         entry — wires the modules to the DOM
src/serial.ts       Web Serial port lifecycle
src/repl.ts         raw REPL protocol
src/editor.ts       CodeMirror 6 setup
src/console.ts      output panel rendering
src/files.ts        download / upload .py
src/ui.ts           button state machine and status indicator
src/styles.css      all styling
dev/                manual test pages, dev server only (not built)
```

### Dev harness pages

Only reachable with `npm run dev`; `npm run build` bundles `index.html` alone.

- `/dev/probe.html` — opens a port, runs the first half of the connect sequence
  and hex-dumps one second of raw bytes. Use it to confirm a board really
  speaks raw REPL before debugging anything further up the stack.
- `/dev/repl-test.html` — drives `repl.ts` directly with no editor or console
  in the way, timestamping each chunk so you can see output streaming.

## Deploying to GitHub Pages

`vite.config.ts` sets `base: './'`, so `dist/` works from any path and needs no
configuration per repo name.

```bash
npm run build
```

Then either point Pages at the `dist/` output via an action, or push the
contents of `dist/` to a `gh-pages` branch:

```bash
npm run build
git worktree add /tmp/pages gh-pages
cp -r dist/* /tmp/pages/
cd /tmp/pages && git add -A && git commit -m "Deploy" && git push
```

Pages serves over HTTPS, which Web Serial requires. (`localhost` is also
treated as a secure context, which is why `npm run dev` works.)
