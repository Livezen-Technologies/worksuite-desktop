import type { Plugin } from 'vite';
export function localizationPlugin(root: string): Plugin;
export function localizationEdits(
  code: string,
  id: string,
): { edits: Array<{ start: number; end: number; text: string }>; messages: Array<{ source: string; line: number }>; source: unknown };
export function transformLocalization(code: string, id: string, corePath: string): { code: string; map: unknown; messages: Array<{ source: string; line: number }> } | null;
