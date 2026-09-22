/**
 * Block definitions and the toolbox for block mode.
 *
 * Shapes follow Scratch: hats start scripts, C-blocks wrap statements, round
 * reporters return values and hexagonal reporters return true/false. Colours
 * are Scratch's own solid category colours so the palette reads the same way.
 *
 * Python for every block lives in blockgen.ts; the two files are keyed by the
 * same `ax_*` type names.
 */

import * as Blockly from 'blockly';
import 'blockly/blocks'; // math_number, text, variables_*, procedures_*

/** [primary, secondary, tertiary] — Scratch 3 category colours. */
const PALETTE = {
  events: ['#FFBF00', '#E6AC00', '#CC9900'],
  control: ['#FFAB19', '#EC9C13', '#CF8B17'],
  motion: ['#4C97FF', '#4280D7', '#3373CC'],
  looks: ['#9966FF', '#855CD6', '#774DCB'],
  lights: ['#0FBD8C', '#0DA57A', '#0B8E69'],
  sound: ['#CF63CF', '#C94FC9', '#BD42BD'],
  pins: ['#5B7A99', '#4E6A85', '#3F5870'],
  sensing: ['#5CB1D6', '#47A8D1', '#2E8EB8'],
  operators: ['#59C059', '#46B946', '#389438'],
  variables: ['#FF8C1A', '#FF8000', '#DB6E00'],
  lists: ['#FF661A', '#FF5500', '#E64D00'],
  procedures: ['#FF6680', '#FF4D6A', '#FF3355'],
} as const;

type PaletteKey = keyof typeof PALETTE;

function style([primary, secondary, tertiary]: readonly string[]): Blockly.Theme.BlockStyle {
  return {
    colourPrimary: primary!,
    colourSecondary: secondary!,
    colourTertiary: tertiary!,
    hat: '',
  };
}

export const BLOCK_STYLES: Record<string, Blockly.Theme.BlockStyle> = {
  ...Object.fromEntries(
    Object.entries(PALETTE).map(([key, colours]) => [`${key}_blocks`, style(colours)]),
  ),
  // Built-in blocks look themselves up under these names.
  variable_blocks: style(PALETTE.variables),
  variable_dynamic_blocks: style(PALETTE.variables),
  procedure_blocks: style(PALETTE.procedures),
  math_blocks: style(PALETTE.operators),
  text_blocks: style(PALETTE.operators),
  logic_blocks: style(PALETTE.operators),
  loop_blocks: style(PALETTE.control),
  list_blocks: style(PALETTE.lists),
};

export const CATEGORY_STYLES: Record<string, Blockly.Theme.CategoryStyle> = Object.fromEntries(
  Object.entries(PALETTE).map(([key, colours]) => [`${key}_category`, { colour: colours[0] }]),
);

/** Loop blocks, for "break out of loop" placement checks. */
export const LOOP_TYPES = new Set(['ax_repeat', 'ax_forever', 'ax_repeat_until', 'ax_while', 'ax_for']);

// ---------------------------------------------------------------------------
// Block JSON helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const value = (name: string, check?: string): Json =>
  check ? { type: 'input_value', name, check } : { type: 'input_value', name };
const bool = (name: string): Json => value(name, 'Boolean');
const statements = (name: string): Json => ({ type: 'input_statement', name });
const dropdown = (name: string, options: [string, string][]): Json => ({
  type: 'field_dropdown',
  name,
  options,
});
const listField = (name = 'LIST'): Json => ({
  type: 'field_variable',
  name,
  variable: null,
  variableTypes: ['List'],
  defaultType: 'List',
});

/** Stack block: notch on top, bump underneath. */
function command(type: string, cat: PaletteKey, message: string, args: Json[], tooltip: string): Json {
  return {
    type,
    message0: message,
    args0: args,
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: `${cat}_blocks`,
    tooltip,
  };
}

/** Round (value) or hexagonal (Boolean) reporter. */
function reporter(
  type: string,
  cat: PaletteKey,
  message: string,
  args: Json[],
  tooltip: string,
  output: string | null = null,
): Json {
  return {
    type,
    message0: message,
    args0: args,
    output,
    inputsInline: true,
    style: `${cat}_blocks`,
    tooltip,
  };
}

const predicate = (type: string, cat: PaletteKey, message: string, args: Json[], tooltip: string): Json =>
  reporter(type, cat, message, args, tooltip, 'Boolean');

/** C-block wrapping one statement input. */
function wrapper(
  type: string,
  message: string,
  args: Json[],
  tooltip: string,
  hasNext = true,
): Json {
  return {
    type,
    message0: message,
    args0: args,
    message1: '%1',
    args1: [statements('DO')],
    previousStatement: null,
    ...(hasNext ? { nextStatement: null } : {}),
    inputsInline: true,
    style: 'control_blocks',
    tooltip,
  };
}

export const COLOURS: [string, string][] = [
  ['red', 'red'],
  ['orange', 'orange'],
  ['yellow', 'yellow'],
  ['green', 'green'],
  ['cyan', 'cyan'],
  ['blue', 'blue'],
  ['purple', 'purple'],
  ['pink', 'pink'],
  ['white', 'white'],
  ['off', 'off'],
];

/** Note name -> frequency in Hz, C4 through C6. */
export const NOTES: Record<string, number> = (() => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const notes: Record<string, number> = {};
  for (let midi = 60; midi <= 84; midi++) {
    const name = `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
    notes[name] = Math.round(440 * 2 ** ((midi - 69) / 12));
  }
  return notes;
})();

const MATH_OPS: [string, string][] = [
  ['abs', 'abs'],
  ['floor', 'floor'],
  ['ceiling', 'ceiling'],
  ['sqrt', 'sqrt'],
  ['sin', 'sin'],
  ['cos', 'cos'],
  ['tan', 'tan'],
  ['asin', 'asin'],
  ['acos', 'acos'],
  ['atan', 'atan'],
  ['ln', 'ln'],
  ['log', 'log'],
  ['e ^', 'e ^'],
  ['10 ^', '10 ^'],
];

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const DEFINITIONS: Json[] = [
  // Control
  command('ax_wait', 'control', 'wait %1 seconds', [value('SECS')], 'Pause for this many seconds.'),
  command('ax_wait_ms', 'control', 'wait %1 milliseconds', [value('MS')], 'Pause for this many milliseconds (1000 ms = 1 second).'),
  wrapper('ax_repeat', 'repeat %1', [value('TIMES')], 'Run the blocks inside this many times.'),
  wrapper('ax_forever', 'forever', [], 'Run the blocks inside over and over until Stop is pressed.', false),
  {
    type: 'ax_if',
    message0: 'if %1 then',
    args0: [bool('COND')],
    message1: '%1',
    args1: [statements('DO')],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'control_blocks',
    tooltip: 'Run the blocks inside only when the condition is true.',
  },
  {
    type: 'ax_if_else',
    message0: 'if %1 then',
    args0: [bool('COND')],
    message1: '%1',
    args1: [statements('DO')],
    message2: 'else',
    message3: '%1',
    args3: [statements('ELSE')],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: 'control_blocks',
    tooltip: 'Run the first group when the condition is true, otherwise the second.',
  },
  command('ax_wait_until', 'control', 'wait until %1', [bool('COND')], 'Pause until the condition becomes true.'),
  wrapper('ax_repeat_until', 'repeat until %1', [bool('COND')], 'Keep running the blocks inside until the condition becomes true.'),
  wrapper('ax_while', 'while %1', [bool('COND')], 'Keep running the blocks inside while the condition is true.'),
  wrapper(
    'ax_for',
    'for each %1 from %2 to %3',
    [{ type: 'field_variable', name: 'VAR', variable: 'i' }, value('FROM'), value('TO')],
    'Count a variable from one number to another, running the blocks inside each time.',
  ),
  {
    type: 'ax_break',
    message0: 'break out of loop',
    previousStatement: null,
    style: 'control_blocks',
    tooltip: 'Leave the loop this block is inside.',
  },
  {
    type: 'ax_stop',
    message0: 'stop program',
    previousStatement: null,
    style: 'control_blocks',
    tooltip: 'End the program right here.',
  },

  // Motors
  command(
    'ax_motors_setup',
    'motion',
    'set up motors left pins %1 %2 right pins %3 %4',
    [value('L1'), value('L2'), value('R1'), value('R2')],
    'Tell the robot which pins drive each motor (two pins per motor, e.g. DRV8833 / L298N IN1 IN2). Swap a pair if that wheel spins backwards.',
  ),
  command(
    'ax_drive',
    'motion',
    'drive %1 at %2 % speed',
    [dropdown('DIR', [['forward', 'forward'], ['backward', 'backward']]), value('SPEED')],
    'Start both wheels. They keep turning until another motor block changes them.',
  ),
  command(
    'ax_drive_for',
    'motion',
    'drive %1 at %2 % speed for %3 seconds',
    [dropdown('DIR', [['forward', 'forward'], ['backward', 'backward']]), value('SPEED'), value('SECS')],
    'Drive for a while, then stop.',
  ),
  command(
    'ax_turn',
    'motion',
    'turn %1 at %2 % speed',
    [dropdown('DIR', [['left ↺', 'left'], ['right ↻', 'right']]), value('SPEED')],
    'Spin in place. Keeps turning until another motor block changes it.',
  ),
  command(
    'ax_turn_for',
    'motion',
    'turn %1 at %2 % speed for %3 seconds',
    [dropdown('DIR', [['left ↺', 'left'], ['right ↻', 'right']]), value('SPEED'), value('SECS')],
    'Spin in place for a while, then stop.',
  ),
  command(
    'ax_motor_set',
    'motion',
    'set %1 motor to %2 % speed',
    [dropdown('SIDE', [['left', 'L'], ['right', 'R'], ['both', 'both']]), value('SPEED')],
    'Speed from -100 (full backwards) to 100 (full forwards). 0 stops.',
  ),
  command(
    'ax_tank',
    'motion',
    'set motor speeds left %1 % right %2 %',
    [value('LEFT'), value('RIGHT')],
    'Set each wheel separately, from -100 to 100.',
  ),
  command('ax_stop_motors', 'motion', 'stop motors', [], 'Stop both wheels.'),
  command(
    'ax_servo',
    'motion',
    'set servo on pin %1 to %2 degrees',
    [value('PIN'), value('ANGLE')],
    'Move a hobby servo to an angle from 0 to 180.',
  ),

  // Console
  command('ax_print', 'looks', 'print %1', [value('TEXT')], 'Show something in the console.'),
  command(
    'ax_print_inline',
    'looks',
    'print %1 on the same line',
    [value('TEXT')],
    'Show something in the console without starting a new line.',
  ),

  // Lights
  command(
    'ax_led',
    'lights',
    'turn LED on pin %1 %2',
    [value('PIN'), dropdown('STATE', [['on', '1'], ['off', '0']])],
    'Switch a single LED on or off. Pin 2 is the built-in LED on most ESP32 boards.',
  ),
  command(
    'ax_strip_setup',
    'lights',
    'set up LED strip on pin %1 with %2 LEDs',
    [value('PIN'), value('COUNT')],
    'Use a NeoPixel / WS2812 colour LED strip.',
  ),
  command('ax_strip_set', 'lights', 'set LED %1 to %2', [value('INDEX'), value('COLOR', 'Colour')], 'Colour one LED. The first LED is number 1.'),
  command('ax_strip_fill', 'lights', 'set all LEDs to %1', [value('COLOR', 'Colour')], 'Colour every LED on the strip.'),
  command('ax_strip_clear', 'lights', 'turn off all LEDs', [], 'Turn every LED on the strip off.'),
  reporter('ax_color', 'lights', '%1', [dropdown('COLOR', COLOURS)], 'A colour.', 'Colour'),
  reporter(
    'ax_color_rgb',
    'lights',
    'red %1 green %2 blue %3',
    [value('R'), value('G'), value('B')],
    'Mix a colour. Each amount goes from 0 to 255.',
    'Colour',
  ),

  // Sound
  command('ax_buzzer_setup', 'sound', 'set up buzzer on pin %1', [value('PIN')], 'Tell the robot which pin the buzzer is on.'),
  command(
    'ax_note',
    'sound',
    'play note %1 for %2 seconds',
    [dropdown('NOTE', Object.keys(NOTES).map((n): [string, string] => [n, n])), value('SECS')],
    'Play a musical note and wait until it finishes.',
  ),
  command(
    'ax_tone',
    'sound',
    'play tone %1 Hz for %2 seconds',
    [value('FREQ'), value('SECS')],
    'Play a pitch and wait until it finishes. 440 Hz is the A above middle C.',
  ),
  command('ax_beep', 'sound', 'beep', [], 'A short beep.'),
  command('ax_sound_off', 'sound', 'stop sound', [], 'Silence the buzzer.'),

  // Pins
  command(
    'ax_pin_write',
    'pins',
    'set pin %1 to %2',
    [value('PIN'), dropdown('STATE', [['HIGH', '1'], ['LOW', '0']])],
    'Turn a pin on (HIGH, 3.3 V) or off (LOW, 0 V).',
  ),
  command('ax_pin_toggle', 'pins', 'toggle pin %1', [value('PIN')], 'Flip a pin between HIGH and LOW.'),
  command(
    'ax_pin_pwm',
    'pins',
    'set pin %1 power to %2 %',
    [value('PIN'), value('PERCENT')],
    'Dim an LED or slow a motor: 0% is off, 100% is fully on.',
  ),

  // Sensing
  predicate('ax_button', 'sensing', 'button on pin %1 pressed?', [value('PIN')], 'True while a button wired between this pin and GND is pressed.'),
  predicate('ax_pin_high', 'sensing', 'pin %1 is HIGH?', [value('PIN')], 'True when the pin reads HIGH.'),
  reporter('ax_digital_read', 'sensing', 'digital read pin %1', [value('PIN')], 'Read a pin as 1 (HIGH) or 0 (LOW).'),
  reporter('ax_analog_read', 'sensing', 'analog read pin %1', [value('PIN')], 'Read a voltage as a number from 0 to 4095.'),
  reporter(
    'ax_distance',
    'sensing',
    'distance cm trig %1 echo %2',
    [value('TRIG'), value('ECHO')],
    'Distance from an HC-SR04 ultrasonic sensor, in cm. Gives 400 when nothing is in range.',
  ),
  reporter('ax_touch', 'sensing', 'touch value on pin %1', [value('PIN')], 'ESP32 touch sensing. The number drops when the pin is touched.'),
  reporter('ax_timer', 'sensing', 'timer', [], 'Seconds since the program started or the timer was reset.'),
  command('ax_timer_reset', 'sensing', 'reset timer', [], 'Set the timer back to 0.'),

  // Operators
  reporter('ax_add', 'operators', '%1 + %2', [value('A'), value('B')], 'Add.'),
  reporter('ax_sub', 'operators', '%1 - %2', [value('A'), value('B')], 'Subtract.'),
  reporter('ax_mul', 'operators', '%1 × %2', [value('A'), value('B')], 'Multiply.'),
  reporter('ax_div', 'operators', '%1 ÷ %2', [value('A'), value('B')], 'Divide.'),
  reporter('ax_random', 'operators', 'pick random %1 to %2', [value('FROM'), value('TO')], 'A random number between the two (inclusive).'),
  predicate('ax_gt', 'operators', '%1 > %2', [value('A'), value('B')], 'True if the first is bigger.'),
  predicate('ax_lt', 'operators', '%1 < %2', [value('A'), value('B')], 'True if the first is smaller.'),
  predicate('ax_eq', 'operators', '%1 = %2', [value('A'), value('B')], 'True if both are the same.'),
  predicate('ax_and', 'operators', '%1 and %2', [bool('A'), bool('B')], 'True if both are true.'),
  predicate('ax_or', 'operators', '%1 or %2', [bool('A'), bool('B')], 'True if either is true.'),
  predicate('ax_not', 'operators', 'not %1', [bool('A')], 'True if it is false.'),
  reporter('ax_join', 'operators', 'join %1 %2', [value('A'), value('B')], 'Stick two pieces of text together.'),
  reporter('ax_letter_of', 'operators', 'letter %1 of %2', [value('INDEX'), value('TEXT')], 'One letter from some text. The first letter is 1.'),
  reporter('ax_length', 'operators', 'length of %1', [value('TEXT')], 'How many letters are in the text.'),
  predicate('ax_contains', 'operators', '%1 contains %2?', [value('TEXT'), value('PART')], 'True if the second text appears inside the first.'),
  reporter('ax_mod', 'operators', '%1 mod %2', [value('A'), value('B')], 'Remainder after dividing.'),
  reporter('ax_round', 'operators', 'round %1', [value('NUM')], 'Round to the nearest whole number.'),
  reporter('ax_mathop', 'operators', '%1 of %2', [dropdown('OP', MATH_OPS), value('NUM')], 'Maths functions. Angles are in degrees.'),
  reporter(
    'ax_map',
    'operators',
    'map %1 from %2 - %3 to %4 - %5',
    [value('VALUE'), value('FROM_LOW'), value('FROM_HIGH'), value('TO_LOW'), value('TO_HIGH')],
    'Rescale a number from one range to another, e.g. a sensor 0-4095 to 0-100.',
  ),
  reporter(
    'ax_constrain',
    'operators',
    'constrain %1 between %2 and %3',
    [value('VALUE'), value('LOW'), value('HIGH')],
    'Keep a number inside a range.',
  ),

  // Lists
  reporter('ax_list_get', 'lists', '%1', [listField()], 'The whole list.'),
  command('ax_list_add', 'lists', 'add %1 to %2', [value('ITEM'), listField()], 'Put an item on the end of the list.'),
  command('ax_list_delete', 'lists', 'delete item %1 of %2', [value('INDEX'), listField()], 'Remove one item. The first item is 1.'),
  command('ax_list_clear', 'lists', 'delete all of %1', [listField()], 'Empty the list.'),
  command(
    'ax_list_insert',
    'lists',
    'insert %1 at %2 of %3',
    [value('ITEM'), value('INDEX'), listField()],
    'Put an item into the list at a position.',
  ),
  command(
    'ax_list_replace',
    'lists',
    'replace item %1 of %2 with %3',
    [value('INDEX'), listField(), value('ITEM')],
    'Change one item in the list.',
  ),
  reporter('ax_list_item', 'lists', 'item %1 of %2', [value('INDEX'), listField()], 'One item from the list. The first item is 1.'),
  reporter('ax_list_index', 'lists', 'item # of %1 in %2', [value('ITEM'), listField()], 'Where the item is in the list, or 0 if it is not there.'),
  reporter('ax_list_length', 'lists', 'length of %1', [listField()], 'How many items are in the list.'),
  predicate('ax_list_contains', 'lists', '%1 contains %2?', [listField(), value('ITEM')], 'True if the item is in the list.'),
];

let registered = false;

/** Register every custom block type. Safe to call more than once. */
export function registerBlocks(): void {
  if (registered) return;
  registered = true;

  Blockly.common.defineBlocksWithJsonArray(DEFINITIONS);

  // Scratch-style text slots: a plain white oval, no quote marks around it.
  Blockly.common.defineBlocksWithJsonArray([
    {
      type: 'text',
      message0: '%1',
      args0: [{ type: 'field_input', name: 'TEXT', text: '' }],
      output: 'String',
      style: 'text_blocks',
      tooltip: 'Some text.',
    },
  ]);

  // "define my block" instead of "to do something", and no placeholder comment.
  Blockly.Msg['PROCEDURES_DEFNORETURN_TITLE'] = 'define';
  Blockly.Msg['PROCEDURES_DEFNORETURN_PROCEDURE'] = 'my block';
  Blockly.Msg['PROCEDURES_DEFNORETURN_COMMENT'] = '';
  Blockly.Msg['PROCEDURES_BEFORE_PARAMS'] = 'with:';

  Blockly.Blocks['ax_start'] = {
    init(this: Blockly.Block) {
      this.jsonInit({
        message0: 'when Run clicked',
        nextStatement: null,
        style: 'events_blocks',
        tooltip: 'Your program starts here. Snap blocks underneath.',
      });
      // Zelos draws the rounded Scratch hat for 'cap'.
      (this as Blockly.Block & { hat?: string }).hat = 'cap';
    },
  };

  // Warn when "break out of loop" sits outside any loop, like Scratch greys it.
  const breakBlock = Blockly.Blocks['ax_break'] as { onchange?: (this: Blockly.Block, e: Blockly.Events.Abstract) => void };
  breakBlock.onchange = function (this: Blockly.Block) {
    if (!this.workspace.isFlyout && this instanceof Blockly.BlockSvg) {
      this.setWarningText(isInsideLoop(this) ? null : 'Put this block inside a loop.');
    }
  };
}

/** True if a loop encloses the block without a function definition in between. */
export function isInsideLoop(block: Blockly.Block): boolean {
  let parent = block.getSurroundParent();
  while (parent) {
    if (LOOP_TYPES.has(parent.type)) return true;
    if (parent.type.startsWith('procedures_def')) return false;
    parent = parent.getSurroundParent();
  }
  return false;
}

// ---------------------------------------------------------------------------
// Toolbox
// ---------------------------------------------------------------------------

type Shadow = { shadow: Json };
const num = (n: number): Shadow => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const txt = (text: string): Shadow => ({ shadow: { type: 'text', fields: { TEXT: text } } });
const colour = (name: string): Shadow => ({ shadow: { type: 'ax_color', fields: { COLOR: name } } });

function block(type: string, inputs?: Record<string, Shadow>, fields?: Json): Json {
  return { kind: 'block', type, ...(inputs ? { inputs } : {}), ...(fields ? { fields } : {}) };
}

const gap = (px: number): Json => ({ kind: 'sep', gap: px });

function category(name: string, cat: PaletteKey, contents: Json[]): Json {
  return { kind: 'category', name, categorystyle: `${cat}_category`, contents };
}

export const TOOLBOX = {
  kind: 'categoryToolbox' as const,
  contents: [
    category('Events', 'events', [block('ax_start')]),
    category('Control', 'control', [
      block('ax_wait', { SECS: num(1) }),
      block('ax_wait_ms', { MS: num(100) }),
      gap(24),
      block('ax_repeat', { TIMES: num(10) }),
      block('ax_forever'),
      gap(24),
      block('ax_if'),
      block('ax_if_else'),
      block('ax_wait_until'),
      block('ax_repeat_until'),
      block('ax_while'),
      gap(24),
      block('ax_for', { FROM: num(1), TO: num(10) }),
      block('ax_break'),
      block('ax_stop'),
    ]),
    category('Motors', 'motion', [
      block('ax_motors_setup', { L1: num(25), L2: num(26), R1: num(27), R2: num(14) }),
      gap(24),
      block('ax_drive', { SPEED: num(50) }),
      block('ax_drive_for', { SPEED: num(50), SECS: num(1) }),
      block('ax_turn', { SPEED: num(50) }),
      block('ax_turn_for', { SPEED: num(50), SECS: num(0.5) }),
      block('ax_stop_motors'),
      gap(24),
      block('ax_motor_set', { SPEED: num(50) }),
      block('ax_tank', { LEFT: num(50), RIGHT: num(50) }),
      gap(24),
      block('ax_servo', { PIN: num(13), ANGLE: num(90) }),
    ]),
    category('Console', 'looks', [
      block('ax_print', { TEXT: txt('Hello!') }),
      block('ax_print_inline', { TEXT: txt('Hello!') }),
    ]),
    category('Lights', 'lights', [
      block('ax_led', { PIN: num(2) }),
      gap(24),
      block('ax_strip_setup', { PIN: num(5), COUNT: num(8) }),
      block('ax_strip_set', { INDEX: num(1), COLOR: colour('red') }),
      block('ax_strip_fill', { COLOR: colour('blue') }),
      block('ax_strip_clear'),
      gap(24),
      block('ax_color', undefined, { COLOR: 'green' }),
      block('ax_color_rgb', { R: num(255), G: num(0), B: num(128) }),
    ]),
    category('Sound', 'sound', [
      block('ax_buzzer_setup', { PIN: num(4) }),
      gap(24),
      block('ax_note', { SECS: num(0.5) }),
      block('ax_tone', { FREQ: num(440), SECS: num(0.5) }),
      block('ax_beep'),
      block('ax_sound_off'),
    ]),
    category('Pins', 'pins', [
      block('ax_pin_write', { PIN: num(2) }),
      block('ax_pin_toggle', { PIN: num(2) }),
      block('ax_pin_pwm', { PIN: num(2), PERCENT: num(50) }),
    ]),
    category('Sensing', 'sensing', [
      block('ax_button', { PIN: num(0) }),
      block('ax_pin_high', { PIN: num(15) }),
      block('ax_digital_read', { PIN: num(15) }),
      block('ax_analog_read', { PIN: num(34) }),
      gap(24),
      block('ax_distance', { TRIG: num(5), ECHO: num(18) }),
      block('ax_touch', { PIN: num(4) }),
      gap(24),
      block('ax_timer'),
      block('ax_timer_reset'),
    ]),
    category('Operators', 'operators', [
      block('ax_add', { A: num(0), B: num(0) }),
      block('ax_sub', { A: num(0), B: num(0) }),
      block('ax_mul', { A: num(0), B: num(0) }),
      block('ax_div', { A: num(0), B: num(1) }),
      gap(24),
      block('ax_random', { FROM: num(1), TO: num(10) }),
      gap(24),
      block('ax_gt', { A: num(0), B: num(50) }),
      block('ax_lt', { A: num(0), B: num(50) }),
      block('ax_eq', { A: num(0), B: num(50) }),
      gap(24),
      block('ax_and'),
      block('ax_or'),
      block('ax_not'),
      gap(24),
      block('ax_join', { A: txt('apple '), B: txt('banana') }),
      block('ax_letter_of', { INDEX: num(1), TEXT: txt('apple') }),
      block('ax_length', { TEXT: txt('apple') }),
      block('ax_contains', { TEXT: txt('apple'), PART: txt('a') }),
      gap(24),
      block('ax_mod', { A: num(10), B: num(3) }),
      block('ax_round', { NUM: num(2.5) }),
      block('ax_mathop', { NUM: num(9) }, { OP: 'sqrt' }),
      block('ax_map', { VALUE: num(2048), FROM_LOW: num(0), FROM_HIGH: num(4095), TO_LOW: num(0), TO_HIGH: num(100) }),
      block('ax_constrain', { VALUE: num(150), LOW: num(0), HIGH: num(100) }),
    ]),
    { kind: 'category', name: 'Variables', categorystyle: 'variables_category', custom: 'AX_VARIABLES' },
    { kind: 'category', name: 'Lists', categorystyle: 'lists_category', custom: 'AX_LISTS' },
    { kind: 'category', name: 'My Blocks', categorystyle: 'procedures_category', custom: 'AX_MY_BLOCKS' },
  ],
} as unknown as Blockly.utils.toolbox.ToolboxInfo;

/** Dynamic Variables and Lists categories, rebuilt whenever they are opened. */
export function registerDynamicCategories(workspace: Blockly.WorkspaceSvg): void {
  workspace.registerButtonCallback('AX_MAKE_VARIABLE', (button) => {
    Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace(), undefined, '');
  });
  workspace.registerButtonCallback('AX_MAKE_LIST', (button) => {
    Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace(), undefined, 'List');
  });

  const byName = (type: string) =>
    workspace
      .getVariableMap()
      .getVariablesOfType(type)
      .sort((a, b) => a.getName().localeCompare(b.getName()));

  workspace.registerToolboxCategoryCallback('AX_VARIABLES', () => {
    const items: Json[] = [{ kind: 'button', text: 'Make a Variable', callbackkey: 'AX_MAKE_VARIABLE' }];
    const vars = byName('');
    const first = vars[0];
    if (!first) return items as unknown as Blockly.utils.toolbox.FlyoutItemInfoArray;
    for (const v of vars) items.push(block('variables_get', undefined, { VAR: { id: v.getId() } }));
    items.push(gap(24));
    items.push(block('variables_set', { VALUE: num(0) }, { VAR: { id: first.getId() } }));
    items.push(block('math_change', { DELTA: num(1) }, { VAR: { id: first.getId() } }));
    return items as unknown as Blockly.utils.toolbox.FlyoutItemInfoArray;
  });

  // Scratch's My Blocks: define + call, without Blockly's return-value blocks.
  workspace.registerToolboxCategoryCallback('AX_MY_BLOCKS', (ws) =>
    Blockly.Procedures.flyoutCategory(ws).filter(
      (item) =>
        !('type' in item) || (item.type !== 'procedures_defreturn' && item.type !== 'procedures_ifreturn'),
    ),
  );

  workspace.registerToolboxCategoryCallback('AX_LISTS', () => {
    const items: Json[] = [{ kind: 'button', text: 'Make a List', callbackkey: 'AX_MAKE_LIST' }];
    const lists = byName('List');
    const first = lists[0];
    if (!first) return items as unknown as Blockly.utils.toolbox.FlyoutItemInfoArray;
    const LIST = { LIST: { id: first.getId() } };
    for (const l of lists) items.push(block('ax_list_get', undefined, { LIST: { id: l.getId() } }));
    items.push(
      gap(24),
      block('ax_list_add', { ITEM: txt('thing') }, LIST),
      block('ax_list_delete', { INDEX: num(1) }, LIST),
      block('ax_list_clear', undefined, LIST),
      block('ax_list_insert', { ITEM: txt('thing'), INDEX: num(1) }, LIST),
      block('ax_list_replace', { INDEX: num(1), ITEM: txt('thing') }, LIST),
      gap(24),
      block('ax_list_item', { INDEX: num(1) }, LIST),
      block('ax_list_index', { ITEM: txt('thing') }, LIST),
      block('ax_list_length', undefined, LIST),
      block('ax_list_contains', { ITEM: txt('thing') }, LIST),
    );
    return items as unknown as Blockly.utils.toolbox.FlyoutItemInfoArray;
  });
}

/** Every custom block type, for the generator test. */
export const CUSTOM_BLOCK_TYPES = ['ax_start', ...DEFINITIONS.map((d) => d.type as string)];
