/**
 * CodeMirror 6 setup. The rest of the app only ever sees getValue/setValue.
 */

import { EditorView, basicSetup } from 'codemirror';
import { keymap, type Command } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { indentLess, indentMore } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
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

/**
 * With a selection, indent every touched line. With a bare cursor, insert
 * spaces up to the next indent stop — never a literal tab, which Python would
 * reject when mixed with the space-indented code around it.
 */
const indentOrInsertSpaces: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore(view);
  const unit = state.facet(indentUnit).length;
  view.dispatch(
    state.update(
      state.changeByRange((range) => {
        const col = range.head - state.doc.lineAt(range.head).from;
        const insert = ' '.repeat(unit - (col % unit));
        return {
          changes: { from: range.head, insert },
          range: EditorSelection.cursor(range.head + insert.length),
        };
      }),
      { scrollIntoView: true, userEvent: 'input' },
    ),
  );
  return true;
};

export function createEditor(parent: HTMLElement, options: EditorOptions): Editor {
  const view = new EditorView({
    parent,
    doc: DEFAULT_PROGRAM,
    extensions: [
      basicSetup,
      // Match the 4-space indent the block generator emits.
      indentUnit.of('    '),
      // Tab indents every selected line (or inserts an indent at the cursor);
      // Shift-Tab dedents every line the selection touches.
      keymap.of([
        { key: 'Tab', run: indentOrInsertSpaces },
        { key: 'Shift-Tab', run: indentLess },
      ]),
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
