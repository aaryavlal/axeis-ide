/**
 * Button state machine and status indicator.
 *
 * Every enable/disable decision lives here, so no other module has to reason
 * about which combinations are legal.
 */

export type AppState =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'executing'
  | 'error';

export interface Controls {
  connect: HTMLButtonElement;
  run: HTMLButtonElement;
  stop: HTMLButtonElement;
  download: HTMLButtonElement;
  upload: HTMLButtonElement;
  clear: HTMLButtonElement;
  status: HTMLElement;
  statusText: HTMLElement;
}

export class Ui {
  private state: AppState = 'disconnected';
  private deviceInfo = '';
  private errorMessage = '';

  constructor(private readonly controls: Controls) {
    this.render();
  }

  getState(): AppState {
    return this.state;
  }

  /** Optional `USB xxxx:yyyy` suffix shown once a port is open. */
  setDeviceInfo(info: string): void {
    this.deviceInfo = info;
    this.render();
  }

  set(state: AppState, errorMessage = ''): void {
    this.state = state;
    this.errorMessage = errorMessage;
    this.render();
  }

  private render(): void {
    const c = this.controls;
    const state = this.state;

    const connectedish = state === 'connected' || state === 'executing';
    const localFileOpsAvailable = state !== 'unsupported';

    c.connect.disabled = state === 'unsupported' || state === 'connecting';
    c.connect.textContent = connectedish ? 'Disconnect' : 'Connect';
    c.run.disabled = state !== 'connected';
    c.stop.disabled = state !== 'executing';
    // Saving and loading .py files is local work; it never needs a robot.
    c.download.disabled = !localFileOpsAvailable;
    c.upload.disabled = !localFileOpsAvailable;
    c.clear.disabled = !localFileOpsAvailable;

    c.stop.classList.toggle('is-armed', state === 'executing');
    c.status.dataset['state'] = state;
    c.statusText.textContent = this.statusLabel();
  }

  private statusLabel(): string {
    switch (this.state) {
      case 'unsupported':
        return 'Unsupported browser';
      case 'connecting':
        return 'Connecting...';
      case 'connected':
        return this.deviceInfo ? `Connected · ${this.deviceInfo}` : 'Connected';
      case 'executing':
        return 'Running...';
      case 'error':
        return `Error: ${this.errorMessage}`;
      case 'disconnected':
        return 'Disconnected';
    }
  }
}
