/**
 * Settings search (Settings sidebar): the words each section's settings go by, so a search finds a setting wherever
 * it is and the section opens with the matching rows marked (kit.tsx `SettingsQuery`). Gathered from the sections'
 * labels; a section's own name and these keywords are searched too.
 */
export const SETTINGS_INDEX: Readonly<Record<string, readonly string[]>> = {
  'about': ["About WorkSuite Desktop", "Version", "Components", "Diagnostics"],
  'accounts': ["Accounts aren’t available in this version", "Accounts", "Show its connection health"],
  'ai': ["AI Assistant", "Display mode", "Allow online fallback", "Auto-minimize after sending", "Sound for new answers", "Quick Ask", "Quick Ask shortcut", "Insert results into other apps", "Open the AI Assistant at start-up", "Language for translations", "Header icon & drawer", "Floating chat widget", "Hidden"],
  'chat': ["Chat", "Chat drawer opens as", "Docked (default)", "Floating"],
  'desktop': ["Open at startup", "Startup screen", "Home", "Where I left off", "An app", "A page", "Desktop & startup", "Starting and closing", "Start with your computer", "Start minimized to the tray", "Closing the window keeps WorkSuite in the tray", "Reopen my tabs when WorkSuite starts", "This computer", "Tab suspension", "Always on top", "Safe Mode", "Open WorkSuite links in the desktop app", "Open links from Mail in", "Ask before running actions from links", "A new tab", "The current tab"],
  'devices': ["This device", "Name", "Device id", "System", "Trust", "Credentials stored in", "Last check-in"],
  'features': ["Features", "Apps", "Launcher search", "Global shortcut to open WorkSuite", "Open WorkSuite links in the app", "Edit documents in WorkSuite Office", "Drive sync", "Offline files", "Turn apps on or off", "Managed by your organization", "Sync now"],
  'files': ["Files & Sync", "Drive sync", "WorkSuite folder", "Transfers", "Files moving at once", "Uploads at once", "Downloads at once", "Try again after a network problem", "When an upload’s name is taken", "Bandwidth", "Upload speed", "Download speed", "Storage & Sync", "Download folder", "Ask where to save each time", "Resume after reconnecting", "Treat this connection as metered", "On a metered connection", "Notifications", "When a transfer finishes", "When a transfer fails", "Office files", "All transfers", "Drive storage", "Drive storage used", "Cache on this computer", "Files kept offline", "No separate limit", "Ask", "Keep both", "Skip", "Replace", "Carry on as usual", "One file at a time", "Pause until unmetered", "Unlimited", "Custom", "KB/s", "MB/s"],
  'general': ["Language", "General", "Time zone", "WorkSuite server", "Organizations"],
  'language': ["Language", "Typing Sinhala", "Default font profile", "Legacy text on paste", "Convert clipboard shortcut", "Sinhala fonts on this computer", "Font profiles", "Detect automatically", "Ask me", "Convert to Unicode", "Leave it as it is"],
  'launcher': ["Layout", "Size", "Open as", "Categories in a sidebar", "Order and behaviour", "Group apps by", "Sort", "Open apps in", "Keyboard shortcut", "Pinned apps", "Drag, or use the arrow keys, to reorder", "Pin an app", "Show or hide apps", "Apps", "My groups", "New group name", "Launcher shortcut", "Organization default", "Compact", "Comfortable", "Large", "Popover", "Full screen", "Default categories", "No groups", "My order", "A to Z", "Most used", "A new tab", "The current tab", "A new window"],
  'license': ["License", "Edition", "Status", "Organization", "Valid until", "This device", "Token storage", "Activation limit", "Offline grace", "Entitlements on this device"],
  'local-ai': ["AI Studio", "Local AI", "This computer", "Models to download"],
  'mail': ["Mail settings", "Offline mail on this computer", "Keep messages from the last", "Notifications and other apps", "On this computer", "In WorkSuite storage", "Theme", "Mail layout", "Reading", "Last 7 days", "Last 30 days", "Last 90 days", "Headers only", "7 days", "30 days", "90 days"],
  'meet': ["Pop out the call when I switch apps", "Global mute and camera shortcuts", "Share computer sound when presenting", "Video quality on battery", "Auto", "720p", "360p", "Meet"],
  'monitoring': ["Monitoring"],
  'notifications': ["Notifications & calls", "What reaches you, and when", "Show notifications", "What notifications show", "Notification privacy", "Pause notifications", "Do not disturb on a schedule", "Quiet hours", "From", "Full content", "Sender only", "\"New WorkSuite notification\"", "Ringtone", "Ring on", "Call window on top of other apps", "During Focus / Do not disturb", "Start at login and keep in the tray", "Shortcuts", "Volume", "Where to ring", "Live map and dashboard", "Live map and dashboard shortcuts", "Speakers and headset", "System output only", "Show the window without ringing", "Ring only when a chat is at risk", "Ring as usual", "Desktop app when running, else browser", "The browser first", "Every device", "Card over other apps", "Desktop notification", "Chime", "Count me away after", "1 minute", "2 minutes", "5 minutes", "10 minutes"],
  'offline': ["Offline", "Saved for offline use", "Mail kept offline", "Mail cache", "Changes waiting to sync", "Last 7 days", "Last 30 days", "Last 90 days", "Headers only"],
  'preferences': ["Check spelling as you type", "Preferences", "Theme", "High contrast", "Density", "Sidebar", "Open downloaded files", "Download folder", "Sounds", "Hardware acceleration", "System", "Light", "Dark", "Comfortable", "Compact", "Expanded", "Collapsed", "Auto-hide", "Ask", "Open locally", "Download only", "Organisation filter", "Same in every app", "Separate in each app", "Search shortcuts", "Emergency stop", "Keyboard shortcuts", "Search", "Command palette", "New (in this app)", "New tab", "Close tab", "Reopen closed tab", "Next tab", "Previous tab", "Support: copy the ticket’s link", "AI Assistant", "Switch organization", "Marketing: claim the next contact", "App launcher", "Lock WorkSuite", "Help & Diagnostics", "PDF Studio: open a PDF", "PDF Studio: save", "PDF Studio: print", "PDF Studio: find", "PDF Studio: search comments and bookmarks too", "PDF Studio: zoom in", "PDF Studio: zoom out", "PDF Studio: hand tool", "PDF Studio: select tool", "Toggle microphone", "Toggle camera", "Start instant meeting", "Join next meeting", "Share screen", "Raise or lower hand", "Float the call over other apps", "Add action item", "Add decision", "Push to talk (hold)", "Colour profiles", "Custom profiles", "Name", "Accent colour picker", "Accent hex", "Brand presets", "Background tint", "Background colour", "Short code", "JSON", "Import a colour profile", "Organisation default", "Profile for the organisation"],
  'remote-control': ["Remote control", "Running app and input-helper checks", "Still shows Denied after turning WorkSuite on?", "Let people ask to control my screen", "Emergency stop", "How input reaches this computer", "When you move your own mouse", "Clipboard while someone controls this computer", "Apps nobody can control"],
  'security': ["Security → Lock Screen", "Enable Lock Screen", "Disable Lock Screen", "Automatically lock after", "App lock", "Lock after operating-system lock", "Lock after computer sleep", "Notifications While Locked", "Chat notifications", "Incoming calls and ringing", "Show caller names", "Show sender names", "Message previews", "Notification sounds while locked", "Access While Locked", "Answer Calls While Locked", "Allow Chat While Locked", "Unlock with", "Your account's security", "Custom", "PIN", "Remove PIN", "Timeout in minutes"],
  'sidebar': ["Pinned apps", "Removed from the sidebar", "Reset to default"],
  'updates': ["Verification", "Download", "Download progress", "Update Failed", "Preferences", "Download updates automatically", "Show What's New after updating", "Install automatically when idle 02:00–04:00", "Install when quitting", "Update notifications", "Current version", "Latest version", "Installed as", "Minimum supported", "Channel", "Update Diagnostics", "Windows installer", "macOS app", "AppImage", ".deb package", ".rpm package", "Update channel", "Updates"],
};

/** More words a section is found by. */
const KEYWORDS: Readonly<Record<string, string>> = {
  general: 'time zone server organizations',
  preferences: 'theme dark light density sidebar downloads sounds hardware shortcuts keyboard colour color appearance',
  language: 'sinhala tamil translation interface',
  notifications: 'alerts banners do not disturb dnd sounds ringing calls',
  security: 'lock pin password locked',
  desktop: 'startup launch open first screen home tray minimize start login boot tabs restore links safe mode',
  features: 'enable disable turn on off modules apps policy organization managed enterprise personal sync',
  updates: 'version channel beta stable release',
  offline: 'cache storage',
  files: 'drive sync download upload',
};

export interface SettingsHit<S> {
  section: S;
  /** What matched inside the section (none when only its name did). */
  labels: string[];
}

/** The sections a search finds, in their order, with what matched in each. */
export function searchSettings<S extends { id: string; label: string }>(query: string, sections: readonly S[]): Array<SettingsHit<S>> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: Array<SettingsHit<S>> = [];
  for (const s of sections) {
    const labels = (SETTINGS_INDEX[s.id] ?? []).filter((l) => l.toLowerCase().includes(q));
    if (labels.length || s.label.toLowerCase().includes(q) || (KEYWORDS[s.id] ?? '').includes(q)) out.push({ section: s, labels });
  }
  return out;
}
