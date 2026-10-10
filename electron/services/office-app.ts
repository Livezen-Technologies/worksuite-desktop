import { OFFICE_APP_NAME, OFFICE_APP_PROTOCOL, officeAppLink, type OfficeAppDocument, type OfficeAppStatus } from '@shared/office-open';
import { DesktopError } from '../main/errors';

/** A file handed to WorkSuite Office, as `office:openInDesktopApp` takes it (already checked by the contract). */
export type OfficeAppOpen =
  | { kind: 'drive'; fileId: number; name: string; mode?: 'edit' | 'view'; organizationId?: string | null }
  | { kind: 'copy'; path: string; name: string; organizationId?: string | null };

export interface OfficeAppDeps {
  /** The app the system gives `worksuiteoffice://` links to: Electron's `app.getApplicationNameForProtocol` ('' for none). */
  protocolApp: (url: string) => string;
  /** Hands the link to the system, which gives it to WorkSuite Office (`shell.openExternal`). */
  open: (url: string) => Promise<void>;
  /** The signed-in server and user, or null while nobody is signed in. */
  account: () => { origin: string; userId: string } | null;
  /** The desktop policy lets files be opened in other apps (`desktop.files.open_external`). */
  canOpenFiles: () => boolean;
  audit: (action: string, details: Record<string, unknown>) => void;
}

/**
 * WorkSuite Office, the desktop editor, from this app (worksuite-desktop#322). Whether it is installed is whether a
 * program on this computer takes `worksuiteoffice://` links (WorkSuite Office registers the scheme for its sign-in
 * callback, worksuite-office#6). Opening a file hands it a link this process builds from the signed-in server and
 * user and the file the page named — the page never supplies the link, the server or the user.
 */
export class OfficeApp {
  constructor(private readonly deps: OfficeAppDeps) {}

  private appName(): string | null {
    try {
      const name = this.deps.protocolApp(`${OFFICE_APP_PROTOCOL}://`).trim();
      return name || null;
    } catch {
      return null;
    }
  }

  status(): OfficeAppStatus {
    const appName = this.appName();
    return { installed: !!appName, appName, canOpen: !!appName && !!this.deps.account() && this.deps.canOpenFiles() };
  }

  async open(input: OfficeAppOpen): Promise<boolean> {
    if (!this.deps.canOpenFiles()) throw new DesktopError('POLICY_DENIED', 'Your organisation does not allow opening files in other apps on this computer.');
    if (!this.appName()) throw new DesktopError('UNSUPPORTED', `${OFFICE_APP_NAME} isn’t installed on this computer.`);
    const account = this.deps.account();
    if (!account) throw new DesktopError('NOT_SIGNED_IN', `Sign in to WorkSuite to open files in ${OFFICE_APP_NAME}.`);
    const doc: OfficeAppDocument = input.kind === 'drive' ? { file: input.fileId, mode: input.mode ?? null } : { src: input.path };
    let link: string;
    try {
      link = officeAppLink({ server: account.origin, uid: account.userId, org: input.organizationId ?? null, name: input.name, doc });
    } catch (e) {
      throw new DesktopError('IPC_VALIDATION_FAILED', `That file cannot be opened in ${OFFICE_APP_NAME} (${e instanceof Error ? e.message : 'invalid'}).`);
    }
    await this.deps.open(link);
    // The file, not the link: the name stays out of the log.
    this.deps.audit('office.desktop_app.open', input.kind === 'drive' ? { fileId: input.fileId, mode: input.mode ?? null } : { copy: true });
    return true;
  }
}
