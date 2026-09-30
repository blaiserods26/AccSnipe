import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    alias: {
      'vscode': path.resolve(__dirname, './test/__mocks__/vscode.ts')
    }
  }
});
