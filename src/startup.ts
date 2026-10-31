/**
 * The preamble every program saved to the robot starts with.
 *
 * A robot on battery has no serial console, so the onboard LED is the only
 * proof that main.py actually started. The pause after it gives time to set
 * the robot down before the wheels move.
 */

/** Onboard LED on most ESP32 dev boards. */
const STATUS_LED_PIN = 2;
const BLINKS = 3;
const BLINK_MS = 200;
const SETTLE_SECONDS = 2;

const PREAMBLE = `# Saved by AXEIS IDE. Runs automatically at power-up.
from machine import Pin as _Pin
import time as _time
_led = _Pin(${STATUS_LED_PIN}, _Pin.OUT)
for _ in range(${BLINKS}):
    _led.on()
    _time.sleep_ms(${BLINK_MS})
    _led.off()
    _time.sleep_ms(${BLINK_MS})
_time.sleep(${SETTLE_SECONDS})
del _led, _Pin, _time
# ---- your program ----
`;

export function withStartupSignal(program: string): string {
  return PREAMBLE + program;
}
