# AXEIS IDE

A browser-based IDE for the AXEIS ESP32 robot. Snap together Scratch-style
blocks (the default) or write Python, hit Run, and it executes on the robot over
USB while stdout and stderr stream back into the console panel.

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
2. Build a program in the **Blocks** tab (the default) under a
   **when Run clicked** block, or switch to the **Python** tab and type.
3. **Run** (or Ctrl-Enter / Cmd-Enter) executes the open tab on the robot. The
   console drawer at the bottom opens itself; click its bar (arrow on the right)
   to open or close it at any time.
4. **Stop** sends Ctrl-C and interrupts the running program.
5. **Download** saves the open tab: blocks as `.json`, Python as `.py`.
   **Upload** takes either and opens the matching tab — it never runs it for you.
6. **Open as Python** (Blocks tab) copies the Python your blocks make into the
   Python tab, so you can see or keep editing it.
7. **Disconnect** returns the board to the friendly REPL, so `mpremote` or
   Thonny can pick it up straight afterwards.

### Block mode

Blocks are grouped like Scratch: Events, Control, Motors, Console, Lights,
Sound, Pins, Sensing, Operators, Variables, Lists and My Blocks. Only scripts
under **when Run clicked** (plus My Blocks definitions) run; loose blocks turn
grey and are skipped. The workspace autosaves in the browser.

Hardware blocks take pin numbers, so they fit any wiring:

- **Motors**: two pins per motor (DRV8833 / L9110S / L298N-style IN1 IN2). Swap
  a pair if that wheel runs backwards. Motors and the buzzer are always switched
  off when a program ends or is stopped.
- **Lights**: a plain LED on a pin, or a NeoPixel / WS2812 strip.
- **Sound**: a passive buzzer on a PWM pin.
- **Sensing**: buttons (pin to GND), digital and analog pins, HC-SR04 distance,
  ESP32 touch pins and a timer.

`src/blocks.ts` defines the blocks and toolbox; `src/blockgen.ts` turns them
into MicroPython (stock ESP32 firmware, `machine` and `neopixel` only).

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
src/editor.ts       CodeMirror 6 setup (Python tab)
src/blockspace.ts   Blockly workspace setup (Blocks tab), autosave
src/blocks.ts       block definitions, colours and toolbox
src/blockgen.ts     blocks -> MicroPython
src/console.ts      output panel rendering
src/files.ts        download / upload .py and .json
src/ui.ts           button state machine and status indicator
src/styles.css      all styling
public/blockly-media  Blockly's icons and sounds, served locally
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

`.github/workflows/deploy.yml` builds the site and publishes `dist/` to GitHub
Pages on every push to `main` (or manually from the Actions tab).

One-time setup: in the repo on GitHub, go to **Settings → Pages** and set
**Source** to **GitHub Actions**. The site is then served at
`https://<user>.github.io/<repo>/`.

`vite.config.ts` sets `base: './'`, so `dist/` works from any path and needs no
configuration per repo name.

Pages serves over HTTPS, which Web Serial requires. (`localhost` is also
treated as a secure context, which is why `npm run dev` works.)
