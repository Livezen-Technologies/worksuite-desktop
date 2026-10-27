

/** Meet remote control on this computer (WS-MEET-ENH-01): identity, support, requests, sessions, offers and consent. Re-exported by shared/types.ts (audit D-G13). */

// ── Meet remote control on this computer (WS-MEET-ENH-01) ─────────────────

/** macOS: who the running WorkSuite is, to compare with its entry in Privacy & Security › Accessibility. */
export interface RemoteControlIdentity {
  executable: string;
  bundle: string;
  bundleId: string | null;
  teamId: string | null;
  authority: string | null;
  adhoc: boolean;
  translocated: boolean;
  otherInstalledCopy: boolean;
  development: boolean;
  signingUnavailable: boolean;
}

/** Whether this computer can be controlled, and if not, why — in a sentence. */
export interface RemoteControlSupport {
  available: boolean;
  method: 'sendinput' | 'cgevent' | 'xdotool' | null;
  displayServer: 'win32' | 'quartz' | 'x11' | 'wayland';
  reason: string | null;
  /** macOS: Accessibility, which injecting needs. Elsewhere 'not_required'. */
  accessibility: 'granted' | 'denied' | 'checking' | 'unknown' | 'not_required';
  /**
   * macOS: the running app reports access but its input helper reports denial.
   *  - restart: granted while WorkSuite was running; restarting WorkSuite (and so its helper) finishes it.
   *  - helper: a restart has already been tried; the helper is not being counted as WorkSuite's.
   */
  accessibilityHint?: 'restart' | 'helper' | null;
  accessibilityDetails?: {
    appTrusted: boolean | null;
    helperTrusted: boolean | null;
    helperAccessibility: boolean | null;
    problem: string | null;
    checkedAt: number | null;
    runningApp: string;
    /** The input helper's executable, and whether the last answer came from the running helper or a new one. */
    helperPath?: string;
    helperSource?: 'injector' | 'probe' | null;
    /** Signing and location of the running copy (worksuite-desktop#147); null until known. */
    identity?: RemoteControlIdentity | null;
  };
  /** The computer's policy lets it be controlled at all (the server still decides each time). */
  policyAllows: boolean;
}

export interface RemoteControlRequestView {
  id: number;
  sessionId: number;
  kind: 'request' | 'handover' | 'increase';
  requester: string;
  reason: string | null;
  expiresIn: number;
}

export interface RemoteControlSessionView {
  id: number;
  status: 'CONTROL_APPROVED' | 'CONTROL_ACTIVE' | 'CONTROL_PAUSED';
  controller: string;
  /** The controller's connection in the meeting: the meeting window relays messages from it alone. */
  controllerIdentity: string;
  capsLabel: string;
  pauseReason: string | null;
  /** Why control is paused, as the indicator says it. */
  pauseText: string | null;
  /** When control became active here (ms), for the indicator's clock. */
  since: number | null;
  expiresAt: string | null;
  /** Control is on but this computer is holding the controller back: the person here moved the mouse, or the shared window is not in front. */
  waiting: 'local' | 'window' | null;
  type: 'meeting' | 'support' | 'call';
}

export interface RemoteControlView {
  support: RemoteControlSupport;
  /** "Let people ask to control my screen" when sharing starts. */
  allowRequests: boolean;
  emergencyChord: string;
  /** False when another app holds the emergency chord; the indicator's Stop still works. */
  chordRegistered: boolean;
  /** True when the organisation set the chord, so it is not this person's to change (RC09). */
  chordSetByOrganisation?: boolean;
  share: { uuid: string; shareId: number; label: string; kind: 'screen' | 'window'; allowRequests: boolean; paused: boolean } | null;
  requests: RemoteControlRequestView[];
  session: RemoteControlSessionView | null;
  /** Files the controller offered this computer, waiting for an answer (RC06). */
  offers: RemoteControlOffer[];
  /** This computer may offer the controller files (the grant allows file transfer). */
  canSendFiles: boolean;
}

export interface RemoteControlOffer {
  id: number;
  sessionId: number;
  name: string;
  size: number;
  from: string;
  executable: boolean;
  scan: 'clean' | 'not_scanned' | 'infected';
}

/** What the consent window (RC03) shows for one request. */
export interface RemoteControlConsent {
  id: number;
  kind: 'request' | 'handover' | 'increase';
  requester: string;
  reason: string | null;
  expiresIn: number;
  share: string;
  /** For a handover: who has control now. */
  current: string | null;
  clipboard: 'off' | 'text' | 'text_files';
  fileTransfer: boolean;
  locked: boolean;
}
