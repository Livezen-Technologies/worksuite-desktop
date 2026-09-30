import { useCallback, useEffect, useRef } from 'react';
import { DocxEditor, type DocxEditorRef } from '@betteroffice/docx-react';
import { XlsxEditor, type XlsxEditorApi } from '@betteroffice/xlsx-react';
import { PptxEditor, type PptxEditorApi } from '@betteroffice/pptx-react';
import { configureDefaultFonts } from '@betteroffice/docx/layout';
import { setGoogleFontsEnabled } from '@betteroffice/docx/utils';
import type { PptxFontFace } from '@betteroffice/pptx';
import type { Document } from '@betteroffice/docx/types/document';
import { loadBundledFontBytes, resolveLastResortFace, resolveMetricCompatFace } from '@betteroffice/fonts';
import '@betteroffice/docx-react/styles.css';
import type { BetterFormat } from './format';

/*
 * BetterOffice (Apache-2.0, github.com/Livezen-Technologies/betteroffice): Word, Excel and PowerPoint files
 * edited inside WorkSuite by Rust engines compiled to WebAssembly — no Document Server, no installed app, no
 * network. Fonts are the bundled open, metric-compatible faces, served from the app itself; Google Fonts stay off.
 * This module is its own chunk, loaded only when a document opens here.
 */
configureDefaultFonts({ load: () => import('@betteroffice/fonts') });
setGoogleFontsEnabled(false);

export interface PreparedFile {
  bytes: Uint8Array;
  format: BetterFormat;
  document?: Document;
  fonts?: PptxFontFace[];
}

/** Parses the file once before the editor mounts, so a file the engine cannot read fails here, with its reason. */
export async function prepareFile(bytes: Uint8Array, format: BetterFormat): Promise<PreparedFile> {
  if (format === 'docx') {
    const { parseDocx } = await import('@betteroffice/docx/docx');
    return { bytes, format, document: await parseDocx(bytes) };
  }
  if (format === 'xlsx') {
    const { initWasm, openWorkbook } = await import('@betteroffice/xlsx');
    await initWasm();
    openWorkbook(bytes).dispose();
    return { bytes, format };
  }
  const { initWasm, openPresentation } = await import('@betteroffice/pptx');
  await initWasm();
  const fonts = await Promise.all(
    [false, true].flatMap((bold) =>
      [false, true].map(async (italic) => {
        const face = resolveMetricCompatFace('Arial', bold, italic) ?? resolveLastResortFace('Arial', bold, italic);
        return { family: 'Arial', bold, italic, bytes: new Uint8Array(await loadBundledFontBytes(face)) };
      }),
    ),
  );
  openPresentation(bytes, { fonts }).dispose();
  return { bytes, format, fonts };
}

/** What the tab asks of the editor: the document as it is now, as bytes. */
export interface BetterEditorApi {
  serialize(): Promise<Uint8Array>;
}

export default function BetterEditor({ file, name, readOnly, author, onSave, onChange, onError, onReady }: {
  file: PreparedFile;
  name: string;
  readOnly: boolean;
  author: string | null;
  onSave: (bytes: Uint8Array) => void;
  onChange: () => void;
  onError: (e: Error) => void;
  onReady: (api: BetterEditorApi | null) => void;
}) {
  const docx = useRef<DocxEditorRef>(null);
  const xlsx = useRef<XlsxEditorApi | null>(null);
  const pptx = useRef<PptxEditorApi | null>(null);
  const serializing = useRef(false);
  const cb = useRef({ onSave, onChange, onError });
  useEffect(() => {
    cb.current = { onSave, onChange, onError };
  });

  const changed = useCallback(() => cb.current.onChange(), []);
  const saved = useCallback((bytes: Uint8Array) => {
    if (!serializing.current) cb.current.onSave(bytes);
  }, []);
  const failed = useCallback((e: Error) => cb.current.onError(e), []);
  const workbookReady = useCallback(
    (api: XlsxEditorApi) => {
      xlsx.current = api;
      const off = api.handle.onUpdate(changed);
      return () => {
        off();
        xlsx.current = null;
      };
    },
    [changed],
  );
  const presentationReady = useCallback((api: PptxEditorApi) => {
    pptx.current = api;
  }, []);

  useEffect(() => {
    onReady({
      async serialize() {
        // A cell or text box still being typed into commits on blur.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        await new Promise<void>((r) => setTimeout(r, 0));
        serializing.current = true;
        try {
          const out = file.format === 'docx' ? await docx.current?.save() : file.format === 'xlsx' ? xlsx.current?.handle.save() : await pptx.current?.save();
          if (!out) throw new Error('The editor is still opening the file. Try again in a moment.');
          return new Uint8Array(out as ArrayBuffer | Uint8Array);
        } finally {
          serializing.current = false;
        }
      },
    });
    return () => onReady(null);
  }, [file.format, onReady]);

  if (file.format === 'docx') {
    return (
      <DocxEditor
        ref={docx}
        document={file.document}
        downloadOnSave={false}
        onSave={(buffer) => saved(new Uint8Array(buffer))}
        documentName={name}
        onChange={changed}
        onError={failed}
        mode={readOnly ? 'viewing' : 'editing'}
        author={author ?? undefined}
        showToolbar
        showRuler
        showZoomControl
        colorMode="light"
      />
    );
  }
  if (file.format === 'xlsx') return <XlsxEditor file={file.bytes} fileName={name} onSave={saved} onReady={workbookReady} readOnly={readOnly} />;
  return <PptxEditor file={file.bytes} fileName={name} fonts={file.fonts ?? []} onSave={saved} onChange={changed} onReady={presentationReady} onError={failed} readOnly={readOnly} />;
}
