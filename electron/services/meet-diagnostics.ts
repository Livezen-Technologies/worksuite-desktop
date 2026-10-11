import { desktopCapturer, screen, systemPreferences } from 'electron';
import { meetDiagnostics, type MeetDiagFacts } from '@shared/meet-diagnostics';
import type { DiagnosticCheck, DesktopPolicy, RemoteControlSupport } from '@shared/types';

/**
 * Gathers what Settings › Remote control's checks report (WS-MEET-ENH-01
 * RC09). The rules live in `shared/meet-diagnostics.ts`; this is only the
 * asking, which needs Electron.
 *
 * Nothing here opens a capture, moves a pointer or reads a window title. The
 * capturer is asked for the *list* of screens with no thumbnail, which is the
 * cheapest honest answer to "could this computer share its screen", and on
 * macOS it is read beside the permission so a refusal is named as a refusal
 * rather than as an empty list.
 */
export interface MeetDiagnosticsDeps {
  support: () => RemoteControlSupport;
  policy: () => DesktopPolicy | null;
  realtime: () => string;
}

export class MeetDiagnostics {
  constructor(private readonly deps: MeetDiagnosticsDeps) {}

  async facts(): Promise<MeetDiagFacts> {
    const support = this.deps.support();
    const policy = this.deps.policy();

    return {
      platform: process.platform,
      screenPermission: process.platform === 'darwin' ? this.screenPermission() : null,
      sources: await this.sources(),
      displays: this.displays(),
      accessibility: support.accessibility,
      method: support.method,
      displayServer: support.displayServer,
      clipboard: policy?.remote_clipboard ?? null,
      realtime: this.deps.realtime(),
    };
  }

  async run(): Promise<DiagnosticCheck[]> {
    return meetDiagnostics(await this.facts());
  }

  private screenPermission(): string | null {
    try {
      // Read, never asked for: asking would put a system prompt in front of
      // somebody who only opened a settings page.
      return systemPreferences.getMediaAccessStatus('screen');
    } catch {
      return null;
    }
  }

  private async sources(): Promise<number | null> {
    try {
      const found = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });

      return found.length;
    } catch {
      // Could not be asked is not zero: zero means "nothing to capture", which
      // is a finding, and this is the absence of one.
      return null;
    }
  }

  private displays(): MeetDiagFacts['displays'] {
    try {
      const primary = screen.getPrimaryDisplay().id;

      return screen.getAllDisplays().map((d) => ({
        width: Math.round(d.size.width),
        height: Math.round(d.size.height),
        scale: d.scaleFactor,
        primary: d.id === primary,
      }));
    } catch {
      return null;
    }
  }
}
