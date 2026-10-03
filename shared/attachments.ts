/**
 * Attachments that can harm this computer (ENH-MAIL-03 DMO-SEC-04).
 *
 * - Blocked: files that run as programs or scripts when opened — never opened
 *   or saved from a message here. The organisation can add its own.
 * - Macro-enabled Office files: opened only in WorkSuite's own editor, which
 *   does not run macros (protected view); never handed to another app.
 * Every attachment saved from mail is marked as coming from the internet
 * (macOS quarantine, Windows Mark of the Web), so the system warns before
 * running it too.
 */

export const BLOCKED_EXTENSIONS = [
  'ade', 'adp', 'app', 'appref-ms', 'application', 'bas', 'bat', 'chm', 'cmd', 'com', 'cpl', 'crt', 'diagcab', 'exe', 'fxp', 'gadget', 'hlp', 'hta', 'inf',
  'ins', 'isp', 'jar', 'jnlp', 'js', 'jse', 'ksh', 'lnk', 'mad', 'maf', 'mag', 'mam', 'maq', 'mar', 'mas', 'mat', 'mau', 'mav', 'maw', 'mcf', 'mda', 'mdb',
  'mde', 'mdt', 'mdw', 'mdz', 'msc', 'msh', 'msh1', 'msh2', 'mshxml', 'msi', 'msp', 'mst', 'msix', 'msixbundle', 'ops', 'pcd', 'pif', 'pl', 'plg', 'prf', 'prg', 'ps1',
  'ps1xml', 'ps2', 'ps2xml', 'psc1', 'psc2', 'psd1', 'psm1', 'reg', 'scf', 'scr', 'sct', 'settingcontent-ms', 'shb', 'shs', 'url', 'vb', 'vbe', 'vbp', 'vbs',
  'vhd', 'vhdx', 'vsmacros', 'vsw', 'webpnp', 'website', 'ws', 'wsc', 'wsf', 'wsh', 'xbap', 'xll', 'xnk', 'command', 'scpt', 'workflow', 'action',
] as const;

export const MACRO_EXTENSIONS = ['docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppsm', 'ppam', 'sldm'] as const;

export type AttachmentRisk = 'blocked' | 'macro' | null;

/** The last extension of a name, lower-cased, ignoring a trailing dot or space (the Windows trick). */
export function extensionOf(name: string): string {
  const clean = name.trim().replace(/[.\s]+$/, '').toLowerCase();
  const at = clean.lastIndexOf('.');
  return at >= 0 ? clean.slice(at + 1) : '';
}

export function attachmentRisk(name: string, extra: readonly string[] = []): AttachmentRisk {
  const ext = extensionOf(name);
  if (!ext) return null;
  if ((BLOCKED_EXTENSIONS as readonly string[]).includes(ext) || extra.map((e) => e.toLowerCase().replace(/^\./, '')).includes(ext)) return 'blocked';
  if ((MACRO_EXTENSIONS as readonly string[]).includes(ext)) return 'macro';
  return null;
}
