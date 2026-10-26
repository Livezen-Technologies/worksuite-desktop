import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import a11y from '../../../build-tools/eslint-a11y.mjs';

/** build-tools/eslint-a11y.mjs (audit D-G21): a click the keyboard cannot make, and a picture with no alt, fail lint. */
describe('the a11y lint rules', () => {
  const linter = new Linter({ configType: 'flat' });
  const lint = (code: string) =>
    linter
      .verify(code, [{ files: ['**/*.tsx'], languageOptions: { parser: tseslint.parser as never, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { a11y }, rules: { 'a11y/click-has-keys': 'error', 'a11y/img-alt': 'error' } }], 'x.tsx')
      .map((m) => m.ruleId);

  it('asks a clicked div, span or row for the keyboard, and a picture for its alt', () => {
    expect(lint('const a = <div onClick={go}>x</div>;')).toEqual(['a11y/click-has-keys']);
    expect(lint('const a = <tr onClick={go}><td /></tr>;')).toEqual(['a11y/click-has-keys']);
    expect(lint('const a = <div tabIndex={0} onKeyDown={k} onClick={go}>x</div>;')).toEqual(['a11y/click-has-keys']);
    expect(lint('const a = <img src={s} />;')).toEqual(['a11y/img-alt']);
  });

  it('accepts a control, a pressable element, an item of a composite widget, a click that only stops, and decoration', () => {
    for (const ok of [
      '<button onClick={go}>x</button>',
      '<div role="button" tabIndex={0} onKeyDown={k} onClick={go}>x</div>',
      '<tr tabIndex={0} onKeyDown={k} onClick={go}><td /></tr>',
      '<div role="option" onClick={go}>x</div>',
      '<span role="presentation" onClick={stop}>x</span>',
      '<div contentEditable onClick={go} />',
      '<div {...props} onClick={go} />',
      '<img src={s} alt="" />',
    ]) {
      expect(lint(`const a = ${ok};`), ok).toEqual([]);
    }
  });
});
