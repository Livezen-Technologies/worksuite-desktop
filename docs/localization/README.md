# Sinhala and Tamil localization — issue #60

This implementation is incomplete and must not be advertised as full language support. The shared catalogs are unreviewed drafts. The checked-in coverage report records the current gaps; existing module dictionaries may cover additional wording.

## Architecture

The Vite pre-transform routes static JSX text, selected UI attributes and object captions, toast text and error literals through the shared source-string catalog. React subscriptions update the language without remounting forms. Dynamic records, input, rich text, file names and user-authored content are not translated. Catalog interpolation preserves supplied values. Missing phrases fall back to English and are tracked in memory, without uploading content. Existing module dictionaries retain their translations and use the shared fallback.

The audit covers the transform's eligible source strings, not every product message. Core key dictionaries, ordinary string arrays, some dynamically constructed sentences and server-generated messages require a separate manual inventory. Nested date formatting inside interpolated templates and explicitly configured locales need review.

Language choice is available before sign-in and stored by server/user identity. Sinhala and Tamil fonts are bundled and prioritized. Dates and numbers follow the selected locale while date helpers retain timezone/time-format settings and explicit currency options remain intact. Unicode input remains unchanged. Layouts, search behavior and keyboard/input methods across every module still require manual review.

Native privacy-safe notification summaries use the catalog; full server notification title/body remain unchanged. Online AI sends optional reply_language metadata; local AI gets the same default instruction. Explicit requests for another reply language override the default. Backend changes must be deployed with the desktop work.

## Translation and review

Run `npm run localization:report` to export missing-si.json and missing-ta.json with source locations. Generated exports are ignored; coverage.json is committed. Add reviewed translations to shared/locales/si.json and ta.json, preserving interpolation placeholders. Catalog coverage alone does not establish that the UI reads naturally or fits.

Fluent reviewers must inspect every module, onboarding, preferences, validation, notifications, help and AI in both languages, including long strings and unchanged user text. Record reviewer identity and reviewed commit in review.json and set status to complete only after that review. Run `npm run localization:release-check`; it intentionally fails while catalog gaps or review requirements remain.

Current blockers: thousands of untranslated phrases, manual inventory outside the transform, full notification localization, complete layout/input/search verification and fluent review. No translation service or fluent reviewer was available in this task.
