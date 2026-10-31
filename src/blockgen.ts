/**
 * Blocks -> MicroPython.
 *
 * Only scripts under "when Run clicked" and "My Blocks" definitions become
 * code; loose blocks are ignored, like in Scratch. Hardware helpers (motors,
 * buzzer, LED strip, ...) are emitted only when a block needs them, so a
 * program that just prints stays a one-liner.
 *
 * Everything emitted must run on stock ESP32 MicroPython: no `numbers`
 * module, `time.sleep_ms` / `ticks_ms`, `machine` and `neopixel` only.
 */

import * as Blockly from 'blockly';
import { Order, pythonGenerator as py } from 'blockly/python';
import { isInsideLoop, NOTES, ROBOT_PINS } from './blocks.ts';

py.INDENT = '    ';

type Gen = typeof py;
type Definitions = Record<string, string>;
type BlockGen = (block: Blockly.Block, gen: Gen) => string | [string, number];

/** `definitions_` is protected in the typings but is the documented way to add prologue code. */
const defs = (gen: Gen): Definitions => (gen as unknown as { definitions_: Definitions }).definitions_;

// ---------------------------------------------------------------------------
// Runtime helpers, emitted on demand
// ---------------------------------------------------------------------------

interface Helper {
  deps?: string[];
  code: string;
}

const HELPERS: Record<string, Helper> = {
  time: { code: 'import time' },
  random: { code: 'import random' },
  math: { code: 'import math' },
  Pin: { code: 'from machine import Pin' },
  PWM: { code: 'from machine import PWM' },
  ADC: { code: 'from machine import ADC' },
  TouchPad: { code: 'from machine import TouchPad' },
  time_pulse_us: { code: 'from machine import time_pulse_us' },
  NeoPixel: { code: 'from neopixel import NeoPixel' },

  duty: {
    code: `def _duty(percent):
    return int(max(0, min(100, percent)) * 655.35)`,
  },
  pwm: {
    deps: ['Pin', 'PWM'],
    code: `_pwms = {}

def _pwm_set(pin, freq, duty):
    entry = _pwms.get(pin)
    if entry is None:
        entry = [PWM(Pin(pin), freq=freq), freq]
        _pwms[pin] = entry
    elif entry[1] != freq:
        entry[0].freq(freq)
        entry[1] = freq
    entry[0].duty_u16(duty)

def _pwm_release(pin):
    entry = _pwms.pop(pin, None)
    if entry is not None:
        entry[0].deinit()`,
  },
  pin_out: {
    deps: ['Pin', 'pwm'],
    code: `_pin_state = {}

def _pin_out(pin, value):
    _pwm_release(pin)
    Pin(pin, Pin.OUT).value(value)
    _pin_state[pin] = value

def _pin_toggle(pin):
    _pin_out(pin, 1 - _pin_state.get(pin, 0))`,
  },
  motors: {
    deps: ['time', 'pwm', 'duty'],
    code: `_motor_pins = {'L': (${ROBOT_PINS.motors.L1}, ${ROBOT_PINS.motors.L2}), 'R': (${ROBOT_PINS.motors.R1}, ${ROBOT_PINS.motors.R2})}
_speeds = {'L': 0, 'R': 0}

def _motors_setup(left1, left2, right1, right2):
    _motor_pins['L'] = (left1, left2)
    _motor_pins['R'] = (right1, right2)
    _drive(0, 0)

def _motor(side, speed):
    pins = _motor_pins[side]
    _speeds[side] = speed
    duty = _duty(abs(speed))
    if speed >= 0:
        _pwm_set(pins[0], 1000, duty)
        _pwm_set(pins[1], 1000, 0)
    else:
        _pwm_set(pins[0], 1000, 0)
        _pwm_set(pins[1], 1000, duty)

def _drive(left, right):
    _motor('L', left)
    _motor('R', right)

def _straight(speed):
    _drive(speed, speed)

def _spin(speed):
    _drive(-speed, speed)

def _keep_driving():
    if _speeds['L'] or _speeds['R']:
        print('Still driving. Press Stop to stop the robot.')
        while True:
            time.sleep_ms(100)`,
  },
  servo: {
    deps: ['pwm'],
    code: `def _servo(pin, angle):
    angle = max(0, min(180, angle))
    _pwm_set(pin, 50, int((500 + angle * 2000 / 180) * 65535 / 20000))`,
  },
  buzzer: {
    deps: ['time', 'pwm'],
    code: `_buzzer = [${ROBOT_PINS.buzzer}]

def _tone(freq, seconds):
    pin = _buzzer[0]
    if freq > 0:
        _pwm_set(pin, max(1, min(20000, int(freq))), 32768)
    time.sleep(seconds)
    _sound_off()

def _sound_off():
    entry = _pwms.get(_buzzer[0])
    if entry is not None:
        entry[0].duty_u16(0)`,
  },
  strip: {
    deps: ['Pin', 'NeoPixel'],
    code: `_strip = [None]

def _strip_get():
    if _strip[0] is None:
        _strip[0] = NeoPixel(Pin(${ROBOT_PINS.strip.pin}, Pin.OUT), ${ROBOT_PINS.strip.count})
    return _strip[0]

def _led_set(number, color):
    strip = _strip_get()
    i = int(number) - 1
    if 0 <= i < strip.n:
        strip[i] = color
        strip.write()

def _led_fill(color):
    strip = _strip_get()
    strip.fill(color)
    strip.write()`,
  },
  rgb: {
    code: `def _rgb(r, g, b):
    return (int(max(0, min(255, r))), int(max(0, min(255, g))), int(max(0, min(255, b))))`,
  },
  analog: {
    deps: ['Pin', 'ADC'],
    code: `_adcs = {}

def _analog(pin):
    adc = _adcs.get(pin)
    if adc is None:
        adc = ADC(Pin(pin))
        adc.atten(ADC.ATTN_11DB)
        _adcs[pin] = adc
    return adc.read_u16() >> 4`,
  },
  distance: {
    deps: ['Pin', 'time', 'time_pulse_us'],
    code: `def _distance(trig, echo):
    trig_pin = Pin(trig, Pin.OUT)
    echo_pin = Pin(echo, Pin.IN)
    trig_pin.value(0)
    time.sleep_us(2)
    trig_pin.value(1)
    time.sleep_us(10)
    trig_pin.value(0)
    us = time_pulse_us(echo_pin, 1, 30000)
    if us < 0:
        return 400
    return min(400, round(us / 58, 1))`,
  },
  timer: {
    deps: ['time'],
    code: `_timer = [time.ticks_ms()]

def _timer_seconds():
    return time.ticks_diff(time.ticks_ms(), _timer[0]) / 1000`,
  },
  rand: {
    deps: ['random'],
    code: `def _random(low, high):
    if low > high:
        low, high = high, low
    if low == int(low) and high == int(high):
        return random.randint(int(low), int(high))
    return low + random.random() * (high - low)`,
  },
  map: {
    code: `def _map(value, from_low, from_high, to_low, to_high):
    return to_low + (value - from_low) * (to_high - to_low) / (from_high - from_low)`,
  },
  index_of: {
    code: `def _index_of(items, item):
    return items.index(item) + 1 if item in items else 0`,
  },
};

/** Pull a helper (and whatever it depends on) into the program prologue. */
function need(gen: Gen, key: string): void {
  const d = defs(gen);
  if (key in d) return;
  const helper = HELPERS[key];
  if (!helper) throw new Error(`unknown helper ${key}`);
  for (const dep of helper.deps ?? []) need(gen, dep);
  d[key] = helper.code;
}

py.addReservedWords(
  [
    '_duty', '_pwms', '_pwm_set', '_pwm_release', '_pin_state', '_pin_out', '_pin_toggle',
    '_motor_pins', '_speeds', '_keep_driving', '_motors_setup', '_motor', '_drive', '_straight', '_spin', '_servo',
    '_buzzer', '_tone', '_sound_off', '_strip', '_strip_get', '_led_set', '_led_fill', '_rgb',
    '_adcs', '_analog', '_distance', '_timer', '_timer_seconds', '_random', '_map',
    '_index_of', '_cleanup', 'time', 'random', 'math', 'Pin', 'PWM', 'ADC', 'TouchPad',
    'time_pulse_us', 'NeoPixel',
  ].join(','),
);

// ---------------------------------------------------------------------------
// Code helpers
// ---------------------------------------------------------------------------

const INT_LITERAL = /^-?\d+$/;
const NUMBER_LITERAL = /^-?\d+(\.\d+)?$/;
const STRING_LITERAL = /^(['"]).*\1$/s;

function val(block: Blockly.Block, gen: Gen, name: string, order: number, fallback = '0'): string {
  return gen.valueToCode(block, name, order) || fallback;
}

/** An integer expression: literals stay as-is, anything else gets int(). */
function int(block: Blockly.Block, gen: Gen, name: string): string {
  const code = val(block, gen, name, Order.NONE);
  if (INT_LITERAL.test(code)) return code;
  if (NUMBER_LITERAL.test(code)) return String(Math.round(Number(code)));
  return `int(${code})`;
}

/** A 1-based index turned into a 0-based one. */
function index0(block: Blockly.Block, gen: Gen, name: string): string {
  const code = int(block, gen, name);
  if (INT_LITERAL.test(code)) return String(Number(code) - 1);
  return `${code} - 1`;
}

function str(block: Blockly.Block, gen: Gen, name: string): string {
  const code = val(block, gen, name, Order.NONE, "''");
  return STRING_LITERAL.test(code) ? code : `str(${code})`;
}

function cond(block: Blockly.Block, gen: Gen, name: string, order: number): string {
  return gen.valueToCode(block, name, order) || 'False';
}

function body(block: Blockly.Block, gen: Gen, name = 'DO'): string {
  return gen.statementToCode(block, name) || gen.PASS;
}

function listName(block: Blockly.Block, gen: Gen): string {
  return gen.getVariableName(block.getFieldValue('LIST') as string);
}

function binary(op: string, order: number): BlockGen {
  return (block, gen) => [`${val(block, gen, 'A', order)} ${op} ${val(block, gen, 'B', order)}`, order];
}

function logic(op: string, order: number): BlockGen {
  return (block, gen) => [`${cond(block, gen, 'A', order)} ${op} ${cond(block, gen, 'B', order)}`, order];
}

const COLOUR_RGB: Record<string, string> = {
  red: '(255, 0, 0)',
  orange: '(255, 100, 0)',
  yellow: '(255, 200, 0)',
  green: '(0, 255, 0)',
  cyan: '(0, 255, 255)',
  blue: '(0, 0, 255)',
  purple: '(140, 0, 255)',
  pink: '(255, 40, 120)',
  white: '(255, 255, 255)',
  off: '(0, 0, 0)',
};

const TO_RADIANS = ' * math.pi / 180';
const TO_DEGREES = ' * 180 / math.pi';

// ---------------------------------------------------------------------------
// Block generators
// ---------------------------------------------------------------------------

const GENERATORS: Record<string, BlockGen> = {
  ax_start: () => '',

  // Control
  ax_wait: (b, g) => {
    need(g, 'time');
    return `time.sleep(${val(b, g, 'SECS', Order.NONE)})\n`;
  },
  ax_wait_ms: (b, g) => {
    need(g, 'time');
    return `time.sleep_ms(${int(b, g, 'MS')})\n`;
  },
  ax_repeat: (b, g) => `for _ in range(${int(b, g, 'TIMES')}):\n${body(b, g)}`,
  ax_forever: (b, g) => `while True:\n${body(b, g)}`,
  ax_if: (b, g) => `if ${cond(b, g, 'COND', Order.NONE)}:\n${body(b, g)}`,
  ax_if_else: (b, g) =>
    `if ${cond(b, g, 'COND', Order.NONE)}:\n${body(b, g)}else:\n${body(b, g, 'ELSE')}`,
  ax_wait_until: (b, g) => {
    need(g, 'time');
    return `while not ${cond(b, g, 'COND', Order.LOGICAL_NOT)}:\n${g.INDENT}time.sleep_ms(10)\n`;
  },
  ax_repeat_until: (b, g) => `while not ${cond(b, g, 'COND', Order.LOGICAL_NOT)}:\n${body(b, g)}`,
  ax_while: (b, g) => `while ${cond(b, g, 'COND', Order.NONE)}:\n${body(b, g)}`,
  ax_for: (b, g) => {
    const name = g.getVariableName(b.getFieldValue('VAR') as string);
    const to = int(b, g, 'TO');
    const end = INT_LITERAL.test(to) ? String(Number(to) + 1) : `${to} + 1`;
    return `for ${name} in range(${int(b, g, 'FROM')}, ${end}):\n${body(b, g)}`;
  },
  ax_break: (b) => (isInsideLoop(b) ? 'break\n' : 'pass\n'),
  ax_stop: () => 'raise SystemExit\n',

  // Motors
  ax_motors_setup: (b, g) => {
    need(g, 'motors');
    return `_motors_setup(${['L1', 'L2', 'R1', 'R2'].map((n) => int(b, g, n)).join(', ')})\n`;
  },
  ax_drive: (b, g) => {
    need(g, 'motors');
    const back = b.getFieldValue('DIR') === 'backward';
    return `_straight(${back ? '-' : ''}${val(b, g, 'SPEED', back ? Order.UNARY_SIGN : Order.NONE)})\n`;
  },
  ax_drive_for: (b, g) => {
    need(g, 'motors');
    need(g, 'time');
    const back = b.getFieldValue('DIR') === 'backward';
    const speed = val(b, g, 'SPEED', back ? Order.UNARY_SIGN : Order.NONE);
    return `_straight(${back ? '-' : ''}${speed})\ntime.sleep(${val(b, g, 'SECS', Order.NONE)})\n_drive(0, 0)\n`;
  },
  ax_turn: (b, g) => {
    need(g, 'motors');
    const right = b.getFieldValue('DIR') === 'right';
    return `_spin(${right ? '-' : ''}${val(b, g, 'SPEED', right ? Order.UNARY_SIGN : Order.NONE)})\n`;
  },
  ax_turn_for: (b, g) => {
    need(g, 'motors');
    need(g, 'time');
    const right = b.getFieldValue('DIR') === 'right';
    const speed = val(b, g, 'SPEED', right ? Order.UNARY_SIGN : Order.NONE);
    return `_spin(${right ? '-' : ''}${speed})\ntime.sleep(${val(b, g, 'SECS', Order.NONE)})\n_drive(0, 0)\n`;
  },
  ax_motor_set: (b, g) => {
    need(g, 'motors');
    const side = b.getFieldValue('SIDE') as string;
    const speed = val(b, g, 'SPEED', Order.NONE);
    return side === 'both' ? `_straight(${speed})\n` : `_motor('${side}', ${speed})\n`;
  },
  ax_tank: (b, g) => {
    need(g, 'motors');
    return `_drive(${val(b, g, 'LEFT', Order.NONE)}, ${val(b, g, 'RIGHT', Order.NONE)})\n`;
  },
  ax_stop_motors: (_b, g) => {
    need(g, 'motors');
    return '_drive(0, 0)\n';
  },
  ax_servo: (b, g) => {
    need(g, 'servo');
    return `_servo(${int(b, g, 'PIN')}, ${val(b, g, 'ANGLE', Order.NONE)})\n`;
  },

  // Console
  ax_print: (b, g) => `print(${val(b, g, 'TEXT', Order.NONE, "''")})\n`,
  ax_print_inline: (b, g) => `print(${val(b, g, 'TEXT', Order.NONE, "''")}, end='')\n`,

  // Lights
  ax_led: (b, g) => {
    need(g, 'pin_out');
    return `_pin_out(${int(b, g, 'PIN')}, ${b.getFieldValue('STATE')})\n`;
  },
  ax_strip_setup: (b, g) => {
    need(g, 'strip');
    return `_strip[0] = NeoPixel(Pin(${int(b, g, 'PIN')}, Pin.OUT), ${int(b, g, 'COUNT')})\n`;
  },
  ax_strip_set: (b, g) => {
    need(g, 'strip');
    return `_led_set(${val(b, g, 'INDEX', Order.NONE, '1')}, ${val(b, g, 'COLOR', Order.NONE, '(0, 0, 0)')})\n`;
  },
  ax_strip_fill: (b, g) => {
    need(g, 'strip');
    return `_led_fill(${val(b, g, 'COLOR', Order.NONE, '(0, 0, 0)')})\n`;
  },
  ax_strip_clear: (_b, g) => {
    need(g, 'strip');
    return '_led_fill((0, 0, 0))\n';
  },
  ax_color: (b) => [COLOUR_RGB[b.getFieldValue('COLOR') as string] ?? '(0, 0, 0)', Order.ATOMIC],
  ax_color_rgb: (b, g) => {
    need(g, 'rgb');
    const parts = ['R', 'G', 'B'].map((n) => val(b, g, n, Order.NONE));
    return [`_rgb(${parts.join(', ')})`, Order.FUNCTION_CALL];
  },

  // Sound
  ax_buzzer_setup: (b, g) => {
    need(g, 'buzzer');
    return `_buzzer[0] = ${int(b, g, 'PIN')}\n`;
  },
  ax_note: (b, g) => {
    need(g, 'buzzer');
    const note = b.getFieldValue('NOTE') as string;
    return `_tone(${NOTES[note] ?? 440}, ${val(b, g, 'SECS', Order.NONE)})  # ${note}\n`;
  },
  ax_tone: (b, g) => {
    need(g, 'buzzer');
    return `_tone(${val(b, g, 'FREQ', Order.NONE)}, ${val(b, g, 'SECS', Order.NONE)})\n`;
  },
  ax_beep: (_b, g) => {
    need(g, 'buzzer');
    return '_tone(1000, 0.1)\n';
  },
  ax_sound_off: (_b, g) => {
    need(g, 'buzzer');
    return '_sound_off()\n';
  },

  // Pins
  ax_pin_write: (b, g) => {
    need(g, 'pin_out');
    return `_pin_out(${int(b, g, 'PIN')}, ${b.getFieldValue('STATE')})\n`;
  },
  ax_pin_toggle: (b, g) => {
    need(g, 'pin_out');
    return `_pin_toggle(${int(b, g, 'PIN')})\n`;
  },
  ax_pin_pwm: (b, g) => {
    need(g, 'pwm');
    need(g, 'duty');
    return `_pwm_set(${int(b, g, 'PIN')}, 1000, _duty(${val(b, g, 'PERCENT', Order.NONE)}))\n`;
  },

  // Sensing
  ax_button: (b, g) => {
    need(g, 'Pin');
    return [`Pin(${int(b, g, 'PIN')}, Pin.IN, Pin.PULL_UP).value() == 0`, Order.RELATIONAL];
  },
  ax_pin_high: (b, g) => {
    need(g, 'Pin');
    return [`Pin(${int(b, g, 'PIN')}, Pin.IN).value() == 1`, Order.RELATIONAL];
  },
  ax_digital_read: (b, g) => {
    need(g, 'Pin');
    return [`Pin(${int(b, g, 'PIN')}, Pin.IN).value()`, Order.FUNCTION_CALL];
  },
  ax_analog_read: (b, g) => {
    need(g, 'analog');
    return [`_analog(${int(b, g, 'PIN')})`, Order.FUNCTION_CALL];
  },
  ax_distance: (b, g) => {
    need(g, 'distance');
    return [`_distance(${int(b, g, 'TRIG')}, ${int(b, g, 'ECHO')})`, Order.FUNCTION_CALL];
  },
  ax_touch: (b, g) => {
    need(g, 'Pin');
    need(g, 'TouchPad');
    return [`TouchPad(Pin(${int(b, g, 'PIN')})).read()`, Order.FUNCTION_CALL];
  },
  ax_timer: (_b, g) => {
    need(g, 'timer');
    return ['_timer_seconds()', Order.FUNCTION_CALL];
  },
  ax_timer_reset: (_b, g) => {
    need(g, 'timer');
    return '_timer[0] = time.ticks_ms()\n';
  },

  // Operators
  ax_add: binary('+', Order.ADDITIVE),
  ax_sub: binary('-', Order.ADDITIVE),
  ax_mul: binary('*', Order.MULTIPLICATIVE),
  ax_div: binary('/', Order.MULTIPLICATIVE),
  ax_mod: binary('%', Order.MULTIPLICATIVE),
  ax_gt: binary('>', Order.RELATIONAL),
  ax_lt: binary('<', Order.RELATIONAL),
  ax_eq: binary('==', Order.RELATIONAL),
  ax_and: logic('and', Order.LOGICAL_AND),
  ax_or: logic('or', Order.LOGICAL_OR),
  ax_not: (b, g) => [`not ${cond(b, g, 'A', Order.LOGICAL_NOT)}`, Order.LOGICAL_NOT],
  ax_random: (b, g) => {
    need(g, 'rand');
    return [`_random(${val(b, g, 'FROM', Order.NONE)}, ${val(b, g, 'TO', Order.NONE)})`, Order.FUNCTION_CALL];
  },
  ax_join: (b, g) => [`${str(b, g, 'A')} + ${str(b, g, 'B')}`, Order.ADDITIVE],
  ax_letter_of: (b, g) => [`${str(b, g, 'TEXT')}[${index0(b, g, 'INDEX')}]`, Order.MEMBER],
  ax_length: (b, g) => [`len(${str(b, g, 'TEXT')})`, Order.FUNCTION_CALL],
  ax_contains: (b, g) => [`${str(b, g, 'PART')} in ${str(b, g, 'TEXT')}`, Order.RELATIONAL],
  ax_round: (b, g) => [`round(${val(b, g, 'NUM', Order.NONE)})`, Order.FUNCTION_CALL],
  ax_mathop: (b, g) => {
    const op = b.getFieldValue('OP') as string;
    const x = (order: number) => val(b, g, 'NUM', order);
    if (op === 'abs') return [`abs(${x(Order.NONE)})`, Order.FUNCTION_CALL];
    if (op === '10 ^') return [`10 ** ${x(Order.EXPONENTIATION)}`, Order.EXPONENTIATION];
    need(g, 'math');
    switch (op) {
      case 'floor':
        return [`math.floor(${x(Order.NONE)})`, Order.FUNCTION_CALL];
      case 'ceiling':
        return [`math.ceil(${x(Order.NONE)})`, Order.FUNCTION_CALL];
      case 'sqrt':
        return [`math.sqrt(${x(Order.NONE)})`, Order.FUNCTION_CALL];
      case 'sin':
      case 'cos':
      case 'tan':
        return [`math.${op}(${x(Order.MULTIPLICATIVE)}${TO_RADIANS})`, Order.FUNCTION_CALL];
      case 'asin':
      case 'acos':
      case 'atan':
        return [`math.${op}(${x(Order.NONE)})${TO_DEGREES}`, Order.MULTIPLICATIVE];
      case 'ln':
        return [`math.log(${x(Order.NONE)})`, Order.FUNCTION_CALL];
      case 'log':
        return [`math.log(${x(Order.NONE)}) / math.log(10)`, Order.MULTIPLICATIVE];
      case 'e ^':
        return [`math.exp(${x(Order.NONE)})`, Order.FUNCTION_CALL];
      default:
        throw new Error(`unknown math op ${op}`);
    }
  },
  ax_map: (b, g) => {
    need(g, 'map');
    const args = ['VALUE', 'FROM_LOW', 'FROM_HIGH', 'TO_LOW', 'TO_HIGH'].map((n) => val(b, g, n, Order.NONE));
    return [`_map(${args.join(', ')})`, Order.FUNCTION_CALL];
  },
  ax_constrain: (b, g) => {
    const [v, lo, hi] = ['VALUE', 'LOW', 'HIGH'].map((n) => val(b, g, n, Order.NONE));
    return [`min(max(${v}, ${lo}), ${hi})`, Order.FUNCTION_CALL];
  },

  // Lists (Scratch numbers items from 1)
  ax_list_get: (b, g) => [listName(b, g), Order.ATOMIC],
  ax_list_add: (b, g) => `${listName(b, g)}.append(${val(b, g, 'ITEM', Order.NONE, "''")})\n`,
  ax_list_delete: (b, g) => `del ${listName(b, g)}[${index0(b, g, 'INDEX')}]\n`,
  ax_list_clear: (b, g) => `${listName(b, g)}.clear()\n`,
  ax_list_insert: (b, g) =>
    `${listName(b, g)}.insert(${index0(b, g, 'INDEX')}, ${val(b, g, 'ITEM', Order.NONE, "''")})\n`,
  ax_list_replace: (b, g) =>
    `${listName(b, g)}[${index0(b, g, 'INDEX')}] = ${val(b, g, 'ITEM', Order.NONE, "''")}\n`,
  ax_list_item: (b, g) => [`${listName(b, g)}[${index0(b, g, 'INDEX')}]`, Order.MEMBER],
  ax_list_index: (b, g) => {
    need(g, 'index_of');
    return [`_index_of(${listName(b, g)}, ${val(b, g, 'ITEM', Order.NONE, "''")})`, Order.FUNCTION_CALL];
  },
  ax_list_length: (b, g) => [`len(${listName(b, g)})`, Order.FUNCTION_CALL],
  ax_list_contains: (b, g) => [`${val(b, g, 'ITEM', Order.RELATIONAL, "''")} in ${listName(b, g)}`, Order.RELATIONAL],

  // The stock generator imports `numbers`, which MicroPython does not have.
  math_change: (b, g) =>
    `${g.getVariableName(b.getFieldValue('VAR') as string)} += ${val(b, g, 'DELTA', Order.NONE)}\n`,
};

Object.assign(py.forBlock, GENERATORS);

// ---------------------------------------------------------------------------
// Whole program
// ---------------------------------------------------------------------------

export interface Program {
  code: string;
  /** False when there is no "when Run clicked" block, so nothing would run. */
  hasStart: boolean;
}

export function generateProgram(workspace: Blockly.Workspace): Program {
  py.init(workspace);
  const d = defs(py);

  // Scratch variables start at 0 and lists start empty.
  d['variables'] = Blockly.Variables.allUsedVarModels(workspace)
    .map((v) => `${py.getVariableName(v.getId())} = ${v.getType() === 'List' ? '[]' : '0'}`)
    .join('\n');

  const tops = workspace.getTopBlocks(true).filter((b) => b.isEnabled());
  for (const block of tops) {
    if (block.type.startsWith('procedures_def')) py.blockToCode(block); // stored in definitions
  }

  const start = tops.find((b) => b.type === 'ax_start');
  let main = start ? (py.blockToCode(start) as string) : '';
  if (!main.trim()) main = 'pass\n';

  // "when Run clicked, drive forward" should keep driving, not stop the
  // instant the script ends. So if the wheels are still turning at the end,
  // stay running until Stop is pressed (the Stop button only works while a
  // program is running).
  if ('motors' in d) main += '_keep_driving()\n';

  // Whatever way the program ends (Stop, error, "stop program"), leave nothing
  // moving or beeping. Lights and servos keep their last state on purpose.
  const cleanup: string[] = [];
  if ('motors' in d) cleanup.push('_drive(0, 0)');
  if ('buzzer' in d) cleanup.push('_sound_off()');
  if (cleanup.length > 0) {
    main = `try:\n${py.prefixLines(main, py.INDENT)}finally:\n${py.prefixLines(cleanup.join('\n'), py.INDENT)}\n`;
  }

  return { code: py.finish(main).replace(/^\n+/, ''), hasStart: Boolean(start) };
}
