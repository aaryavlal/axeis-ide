/**
 * CodeMirror 6 setup. The rest of the app only ever sees getValue/setValue.
 */

import { EditorView, basicSetup } from 'codemirror';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';

export const DEFAULT_PROGRAM = 'print("Hello from AXEIS")\n';

export interface Editor {
  getValue(): string;
  setValue(text: string): void;
  focus(): void;
}

export interface EditorOptions {
  /** Ctrl-Enter / Cmd-Enter. */
  onRun: () => void;
}

export function createEditor(parent: HTMLElement, options: EditorOptions): Editor {
  const view = new EditorView({
    parent,
    doc: DEFAULT_PROGRAM,
    extensions: [
      basicSetup,
      python(),
      oneDark,
      EditorView.theme({
        '&': { height: '100%', fontSize: '14px' },
        '.cm-scroller': {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          lineHeight: '1.55',
        },
      }),
    ],
  });

  // Capture phase on the container: runs ahead of CodeMirror's own Mod-Enter
  // binding (insertBlankLine) without needing the keymap package directly.
  parent.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      event.stopPropagation();
      options.onRun();
    },
    true,
  );

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (text: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    focus: () => view.focus(),
  };
}
