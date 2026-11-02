/**
 * What Save to robot puts on the board so a program runs at power-up.
 *
 * The program itself goes in program.py; main.py (run by MicroPython at every
 * boot) is a fixed launcher around it. A robot on battery has no serial
 * console, so the launcher reports through the onboard LED and a log file:
 *
 *   3 blinks, 2 s pause       the board booted and is about to start the program
 *   steady slow blinking      the program is running
 *   fast blinking             the program crashed (motors are switched off)
 *
 * boot_log.txt records each step, and the traceback if it crashed, so the
 * next USB connection can show what happened on battery. It keeps earlier
 * boots too: one power-on that logs several boots means the board kept
 * resetting (typically as the motors start).
 */

import { ROBOT_PINS } from './blocks.ts';

export const PROGRAM_PATH = '/program.py';
export const MAIN_PATH = '/main.py';
export const BOOT_LOG_PATH = '/boot_log.txt';

/** Onboard LED on most ESP32 dev boards. */
const STATUS_LED_PIN = 2;
const BLINKS = 3;
const BLINK_MS = 200;
const SETTLE_SECONDS = 2;
/** LED toggle period while program.py runs; a hardware timer drives it. */
const RUN_BLINK_MS = 1000;
const RUN_BLINK_TIMER = 3;
const CRASH_BLINK_MS = 500;
/** Start the log afresh past this size so it never fills the flash. */
const LOG_MAX_BYTES = 4000;

const { L1, L2, R1, R2 } = ROBOT_PINS.motors;

export const MAIN_PY = `# Saved by AXEIS IDE. MicroPython runs this at every power-up.
# Your program is in program.py; this file starts it and reports problems.
import machine
import os
import sys
import time
from machine import Pin, Timer

_LOG = '${BOOT_LOG_PATH}'
_led = Pin(${STATUS_LED_PIN}, Pin.OUT)

def _log(msg):
    try:
        with open(_LOG, 'a') as f:
            f.write('%d ms: %s\\n' % (time.ticks_ms(), msg))
    except OSError:
        pass

try:
    if os.stat(_LOG)[6] > ${LOG_MAX_BYTES}:
        os.remove(_LOG)
except OSError:
    pass
_log('--- booted, aaryav reset cause %d ---' % machine.reset_cause())
for _ in range(${BLINKS}):
    _led.on()
    time.sleep_ms(${BLINK_MS})
    _led.off()
    time.sleep_ms(${BLINK_MS})
time.sleep(${SETTLE_SECONDS})

_log('program starting')
_blink = Timer(${RUN_BLINK_TIMER})
_blink.init(period=${RUN_BLINK_MS}, mode=Timer.PERIODIC,
            callback=lambda t: _led.value(not _led.value()))
try:
    try:
        import program
    finally:
        _blink.deinit()
        _led.off()
    _log('program finished aaryav')
except Exception as e:
    try:
        with open(_LOG, 'a') as f:
            f.write('program crashed:\\n')
            sys.print_exception(e, f)
    except OSError:
        pass
    for _p in (${L1}, ${L2}, ${R1}, ${R2}):
        Pin(_p, Pin.OUT, value=0)
    for i in range(20):
        _led.value(not _led.value())
        time.sleep_ms(${CRASH_BLINK_MS})
`;
