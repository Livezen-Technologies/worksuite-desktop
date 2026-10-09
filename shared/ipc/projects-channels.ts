/**
 * WorkSuite Projects' IPC channels (the tray timer, the mini timer window and the offline outbox). Plain data, like
 * channels.ts, so the sandboxed preload can import it; spread into INVOKE_CHANNELS / EVENT_CHANNELS there. The
 * schemas and answers are in shared/projects.ts; the handlers in electron/services/projects/index.ts.
 */
export const PROJECTS_INVOKE_CHANNELS = [
  'projects:timer',
  'projects:timerRefresh',
  'projects:timerStart',
  'projects:timerStop',
  'projects:timerSwitch',
  'projects:timerPause',
  'projects:timerResume',
  'projects:timerNote',
  'projects:timerWindow',
  'projects:outbox',
  'projects:submit',
  'projects:resolve',
  'projects:discard',
  'projects:replay',
] as const;

export const PROJECTS_EVENT_CHANNELS = ['projects:changed'] as const;
