/**
 * Moving programs (.py text or .json blocks) between the IDE and the user's
 * laptop. Nothing here touches the robot.
 */

const DEFAULT_FILENAME = 'robot_program.py';
const DEFAULT_BLOCKS_FILENAME = 'robot_program.json';
const PY_MIME = 'text/x-python';
const JSON_MIME = 'application/json';

export interface LoadedFile {
  name: string;
  text: string;
}

/**
 * Cheap content fingerprint for unsaved-changes detection (djb2). Not a
 * security boundary — it only answers "did this text change".
 */
export function hashContents(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

/**
 * Ask for a filename and save the editor contents.
 * Returns the filename used, or null if the user cancelled the prompt.
 */
export function downloadPython(contents: string): string | null {
  return saveAs(contents, DEFAULT_FILENAME, '.py', PY_MIME);
}

/** Save a block program as JSON. Returns the filename, or null if cancelled. */
export function downloadBlocks(state: object): string | null {
  return saveAs(JSON.stringify(state, null, 2), DEFAULT_BLOCKS_FILENAME, '.json', JSON_MIME);
}

export function isBlocksFile(name: string): boolean {
  return name.toLowerCase().endsWith('.json');
}

function saveAs(contents: string, defaultName: string, extension: string, mime: string): string | null {
  const answer = window.prompt('Save program as:', defaultName);
  if (answer === null) return null;

  const trimmed = answer.trim();
  const name = trimmed.length === 0 ? defaultName : trimmed;
  const filename = name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`;

  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return filename;
}

/**
 * Open the file picker and read the chosen file as text.
 * Resolves null if the user picked nothing.
 */
export function pickFile(input: HTMLInputElement): Promise<LoadedFile | null> {
  return new Promise((resolve, reject) => {
    const done = (): void => {
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
    };

    const onCancel = (): void => {
      done();
      resolve(null);
    };

    const onChange = (): void => {
      const file = input.files?.[0];
      done();
      // Reset so picking the same file twice in a row still fires change.
      input.value = '';
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        resolve({ name: file.name, text: String(reader.result ?? '') });
      };
      reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
      reader.readAsText(file);
    };

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    input.click();
  });
}
