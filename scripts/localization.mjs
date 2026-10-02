#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { localizationEdits } from '../build-tools/localization.mjs';
const root = resolve(import.meta.dirname, '..');
const phrases = new Map();
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = resolve(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file) && !file.includes('/core/') && !/\/i18n\.ts$/.test(file)) {
      for (const item of localizationEdits(readFileSync(file, 'utf8'), file).messages) {
        if (!phrases.has(item.source)) phrases.set(item.source, []);
        phrases.get(item.source).push(`${relative(root, file)}:${item.line}`);
      }
    }
  }
}
walk(resolve(root, 'src'));
const review = JSON.parse(readFileSync(resolve(root, 'docs/localization/review.json'), 'utf8'));
const report = {};
for (const lang of ['si', 'ta']) {
  const catalog = JSON.parse(readFileSync(resolve(root, `shared/locales/${lang}.json`), 'utf8'));
  const entries = [...phrases].sort(([a], [b]) => a.localeCompare(b));
  const missing = entries.filter(([phrase]) => !(phrase.trim() in catalog)).map(([source, locations]) => ({ source, locations }));
  report[lang] = {
    total: entries.length,
    translated: entries.length - missing.length,
    missing: missing.length,
    fluentSpeakerReview: review[lang]?.status === 'complete' && review[lang]?.reviewer && review[lang]?.reviewedCommit ? 'complete' : 'pending',
  };
  if (process.argv.includes('--write')) {
    mkdirSync(resolve(root, 'docs/localization'), { recursive: true });
    writeFileSync(resolve(root, `docs/localization/missing-${lang}.json`), JSON.stringify(missing, null, 2) + '\n');
  }
}
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--write')) writeFileSync(resolve(root, 'docs/localization/coverage.json'), JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--release') && Object.values(report).some((r) => r.missing > 0 || r.fluentSpeakerReview !== 'complete')) process.exitCode = 1;
