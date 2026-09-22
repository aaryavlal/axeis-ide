/**
 * Moving .py files between the editor and the user's laptop. Nothing here
 * touches the robot.
 */

const DEFAULT_FILENAME = 'robot_program.py';
const PY_MIME = 'text/x-python';

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
  const answer = window.prompt('Save program as:', DEFAULT_FILENAME);
  if (answer === null) return null;

  const trimmed = answer.trim();
  const name = trimmed.length === 0 ? DEFAULT_FILENAME : trimmed;
  const filename = name.toLowerCase().endsWith('.py') ? name : `${name}.py`;

  const url = URL.createObjectURL(new Blob([contents], { type: PY_MIME }));
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
export function pickPythonFile(input: HTMLInputElement): Promise<LoadedFile | null> {
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
