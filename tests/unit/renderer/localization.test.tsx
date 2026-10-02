// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { transformLocalization } from '../../../build-tools/localization.mjs';
import { clearMissingTranslations, localize, missingTranslations, replyLanguageInstruction, searchFold } from '../../../shared/localization';
import * as i18n from '../../../src/core/i18n';
import { dateLabel, setRegional, timeLabel } from '../../../src/core/time';

function compiled(source: string): { Editor: React.FC; choice: { id: string; label: string } } {
  const transformed = transformLocalization(source, '/project/src/modules/example/Editor.tsx', '/project/src/core/i18n');
  expect(transformed).not.toBeNull();
  const code = ts.transpileModule(transformed!.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const load = (name: string) => (name === 'react' ? React : name === 'react/jsx-runtime' ? jsxRuntime : i18n);
  new Function('require', 'exports', code)(load, exports);
  return exports as ReturnType<typeof compiled>;
}
afterEach(() => {
  cleanup();
  i18n.setLanguage('en');
  clearMissingTranslations();
});
describe('static interface localization (#60)', () => {
  it('localizes compiled controls immediately without changing user content, identifiers or input state', () => {
    const { Editor, choice } = compiled(`import {useState} from 'react';
      export const choice={id:'Save',label:'Save'};
      export function Editor(){const [name,setName]=useState('Save'); return <div><label>Name<input aria-label="Name" value={name} onChange={e=>setName(e.target.value)}/></label><button title="Save">Save</button><span data-user>{name}</span></div>}`);
    const view = render(<Editor />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'මගේ නම தமிழ்' } });
    act(() => i18n.setLanguage('si'));
    expect(screen.getByRole('button').textContent).toBe('සුරකින්න');
    expect(screen.getByRole('button').title).toBe('සුරකින්න');
    expect(screen.getByRole('textbox')).toBe(input);
    expect((input as HTMLInputElement).value).toBe('මගේ නම தமிழ்');
    expect(view.container.querySelector('[data-user]')?.textContent).toBe('මගේ නම தமிழ்');
    expect(choice).toMatchObject({ id: 'Save', label: 'සුරකින්න' });
    act(() => i18n.setLanguage('ta'));
    expect(screen.getByRole('button').textContent).toBe('சேமி');
    expect((input as HTMLInputElement).value).toBe('මගේ නම தமிழ்');
    choice.label = 'User label';
    expect(choice.label).toBe('User label');
  });
  it('falls back to English and records only the missing source, never interpolation data', () => {
    expect(localize('Missing {name}', 'ta', { name: 'Private customer' })).toBe('Missing Private customer');
    expect(missingTranslations()).toEqual([{ language: 'ta', source: 'Missing {name}' }]);
    expect(localize('New from {sender}', 'si', { sender: '{module}' })).toContain('{module}');
    expect(localize(' Save ', 'ta')).toBe(' சேமி ');
  });
  it('decodes JSX entities, preserves whitespace and keeps protocol identifiers unchanged', () => {
    const out = transformLocalization(
      'export function Editor(){return <button data-id="save" title="Save &amp; close">Save &amp; close</button>}',
      '/p/src/Editor.tsx',
      '/p/src/core/i18n',
    )!;
    expect(out.code).toContain('__wsText("Save & close")');
    expect(out.code).toContain('data-id="save"');
    expect(out.code).not.toContain('__wsText("save")');
  });
  it('formats dates in the selected locale and preserves the configured timezone', () => {
    setRegional({ timezone: 'Asia/Colombo', locale: 'en-GB', timeFormat: '24' });
    i18n.setLanguage('ta');
    const value = '2026-10-02T04:30:00Z';
    expect(dateLabel(value)).toBe(new Date(value).toLocaleDateString('ta-LK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Colombo', hour12: false }));
    expect(timeLabel(value)).toBe(new Date(value).toLocaleTimeString('ta-LK', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Colombo', hour12: false }));
  });
  it('supports canonical Unicode search and explicit AI reply-language overrides', () => {
    expect(searchFold('e\u0301', 'si')).toBe(searchFold('é', 'si'));
    expect(searchFold('தமிழ்', 'ta')).toBe('தமிழ்');
    expect(replyLanguageInstruction('si')).toContain('Answer in Sinhala by default');
    expect(replyLanguageInstruction('ta')).toContain('explicitly requests another reply language');
  });
});
