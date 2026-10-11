/**
 * Apps control must never reach (WS-MEET-ENH-01 RC09's Protected apps list).
 *
 * Password managers and the system's own prompts. While one of them is in
 * front, control pauses — the pause is decided here, on the computer being
 * controlled, rather than asked of anybody — and only the person here can
 * resume it.
 *
 * It lives in `shared/` because Settings shows the list: somebody who is about
 * to let a colleague drive their computer deserves to read what is excluded,
 * and a list the service keeps privately could not be read without being
 * copied, which is how two lists drift apart.
 *
 * Matched as a substring of the app's name and its window title, lowercased —
 * so '1password' also catches "1Password 7" and its browser extension window.
 */
export const PROTECTED_APPS = [
  '1password',
  'keepass',
  'bitwarden',
  'lastpass',
  'dashlane',
  'enpass',
  'keeper',
  'keychain access',
  'securityagent',
  'credential',
  'consent.exe',
  'windows security',
  'polkit',
  'gcr-prompter',
  'pinentry',
  'seahorse',
] as const;

/** How the list reads in Settings: the names people recognise, not the matches. */
export const PROTECTED_APP_LABELS: Array<{ label: string; what: string }> = [
  { label: 'Password managers', what: '1Password, Bitwarden, KeePass, LastPass, Dashlane, Enpass, Keeper' },
  { label: 'The system’s own keychain and prompts', what: 'Keychain Access, SecurityAgent, Windows Security, credential prompts, User Account Control (consent.exe)' },
  { label: 'Linux password dialogs', what: 'polkit, gcr-prompter, pinentry, Seahorse' },
];
