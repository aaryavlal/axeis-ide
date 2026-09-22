/**
 * The Blockly workspace for block mode. The rest of the app sees a program to
 * run and a JSON document to save or load, nothing Blockly-specific.
 */

import * as Blockly from 'blockly';
import { registerContinuousToolbox } from '@blockly/continuous-toolbox';
import { BLOCK_STYLES, CATEGORY_STYLES, registerBlocks, registerDynamicCategories, TOOLBOX } from './blocks.ts';
import { generateProgram, type Program } from './blockgen.ts';

const STORAGE_KEY = 'axeis-ide.blocks.v1';
const AUTOSAVE_DELAY_MS = 400;

export const DEFAULT_BLOCKS = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'ax_start',
        x: 48,
        y: 48,
        next: {
          block: {
            type: 'ax_print',
            inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'Hello from AXEIS' } } } },
          },
        },
      },
    ],
  },
};

export interface BlockEditor {
  getProgram(): Program;
  /** Serialized workspace, for Download. */
  save(): object;
  /** Replace the workspace; throws if the JSON is not a block program. */
  load(state: object): void;
  resize(): void;
}

const theme = Blockly.Theme.defineTheme('axeis-dark', {
  name: 'axeis-dark',
  base: Blockly.Themes.Classic,
  blockStyles: BLOCK_STYLES,
  categoryStyles: CATEGORY_STYLES,
  componentStyles: {
    workspaceBackgroundColour: '#0d1117',
    toolboxBackgroundColour: '#10151c',
    toolboxForegroundColour: '#c9d1d9',
    flyoutBackgroundColour: '#161b22',
    flyoutForegroundColour: '#c9d1d9',
    flyoutOpacity: 1,
    scrollbarColour: '#484f58',
    scrollbarOpacity: 0.7,
    insertionMarkerColour: '#ffffff',
    insertionMarkerOpacity: 0.3,
    cursorColour: '#2f81f7',
  },
  fontStyle: {
    family: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    weight: '600',
    size: 12,
  },
});

function readStored(): object | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as object) : null;
  } catch {
    return null;
  }
}

function writeStored(state: object): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private window or full storage: autosave is a convenience, not a promise.
  }
}

export function createBlockEditor(host: HTMLElement): BlockEditor {
  registerBlocks();
  registerContinuousToolbox();

  // The continuous flyout builds every category during inject, before our
  // Variables / Lists callbacks can be registered on the workspace. Start
  // without them, register, then swap the full toolbox in.
  const staticToolbox = {
    ...TOOLBOX,
    contents: TOOLBOX.contents.filter((item) => !('custom' in item)),
  };
  const workspace = Blockly.inject(host, {
    toolbox: staticToolbox,
    renderer: 'zelos',
    theme,
    media: './blockly-media/',
    plugins: {
      flyoutsVerticalToolbox: 'ContinuousFlyout',
      metricsManager: 'ContinuousMetrics',
      toolbox: 'ContinuousToolbox',
    },
    grid: { spacing: 32, length: 2, colour: '#1f262f', snap: false },
    zoom: { controls: true, wheel: false, pinch: true, startScale: 0.8, maxScale: 2, minScale: 0.4 },
    move: { scrollbars: true, drag: true, wheel: true },
    trashcan: true,
    maxInstances: { ax_start: 1 },
  });
  registerDynamicCategories(workspace);
  workspace.updateToolbox(TOOLBOX);

  // Loose blocks turn grey and are skipped, so it is obvious what will run.
  workspace.addChangeListener(Blockly.Events.disableOrphans);

  const load = (state: object): void => {
    Blockly.Events.disable();
    try {
      workspace.clear();
    } finally {
      Blockly.Events.enable();
    }
    Blockly.serialization.workspaces.load(state, workspace);
    workspace.scrollCenter();
  };

  try {
    load(readStored() ?? DEFAULT_BLOCKS);
  } catch {
    load(DEFAULT_BLOCKS);
  }

  let saveTimer: number | undefined;
  workspace.addChangeListener((event) => {
    if (event.isUiEvent) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(
      () => writeStored(Blockly.serialization.workspaces.save(workspace)),
      AUTOSAVE_DELAY_MS,
    );
  });

  new ResizeObserver(() => Blockly.svgResize(workspace)).observe(host);

  return {
    getProgram: () => generateProgram(workspace),
    save: () => Blockly.serialization.workspaces.save(workspace),
    load: (state) => {
      const previous = Blockly.serialization.workspaces.save(workspace);
      try {
        load(state);
      } catch (err) {
        load(previous);
        throw err;
      }
    },
    resize: () => Blockly.svgResize(workspace),
  };
}
