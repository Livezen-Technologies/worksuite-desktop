/** The formats BetterOffice edits inside WorkSuite (OOXML only; .doc, .xls, .odt… go to EuroOffice or an installed app). */
export type BetterFormat = 'docx' | 'xlsx' | 'pptx';

export const BETTER_FORMATS: readonly BetterFormat[] = ['docx', 'xlsx', 'pptx'];

export function betterFormat(name: string, extension?: string | null): BetterFormat | null {
  const e = (extension || name.split('.').pop() || '').toLowerCase();
  return (BETTER_FORMATS as readonly string[]).includes(e) ? (e as BetterFormat) : null;
}
