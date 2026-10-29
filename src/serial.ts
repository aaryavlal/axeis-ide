/**
 * Web Serial port lifecycle. Knows nothing about MicroPython — it only opens,
 * describes and watches ports. All control-byte handling lives in repl.ts.
 */

export const BAUD_RATE = 115200;

/** The user dismissed the browser's port picker. Not an error worth surfacing. */
export class PortPickerCancelled extends Error {
  constructor() {
    super('Serial port picker cancelled');
    this.name = 'PortPickerCancelled';
  }
}

/** The browser or an embedder policy refused serial access. */
export class PortPermissionDenied extends Error {
  constructor() {
    super('Permission required to connect');
    this.name = 'PortPermissionDenied';
  }
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * Show the browser port picker.
 *
 * Chromium throws NotFoundError both when the user cancels and when there is
 * nothing to pick; either way there is no port and nothing to report.
 * SecurityError means the permission itself was refused, which the user does
 * need to hear about.
 */
export async function requestPort(): Promise<SerialPort> {
  try {
    return await navigator.serial.requestPort();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'SecurityError') {
      throw new PortPermissionDenied();
    }
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      throw new PortPickerCancelled();
    }
    throw err;
  }
}

export async function openPort(port: SerialPort): Promise<void> {
  await port.open({
    baudRate: BAUD_RATE,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none',
  });
  // On ESP32 dev boards DTR/RTS drive the auto-reset circuit (EN and GPIO0).
  // Left asserted, the board can sit in reset or drop into the ROM bootloader.
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch (err) {
    // Some adapters (e.g. native USB CDC) reject this; the REPL can still work.
    console.warn('[serial] could not clear DTR/RTS', err);
  }
}

/** Short USB id string for the status bar, or '' when the platform hides it. */
export function describePort(port: SerialPort): string {
  const info = port.getInfo();
  const hex = (value: number): string => value.toString(16).padStart(4, '0');
  if (info.usbVendorId === undefined) return '';
  if (info.usbProductId === undefined) return `USB ${hex(info.usbVendorId)}`;
  return `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}`;
}

/** Fires when a port physically goes away (cable pulled, board reset out). */
export function onSerialDisconnect(handler: (port: SerialPort) => void): void {
  navigator.serial.addEventListener('disconnect', (event: Event) => {
    handler(event.target as SerialPort);
  });
}
