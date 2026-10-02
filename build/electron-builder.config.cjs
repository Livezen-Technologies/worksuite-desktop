/**
 * Packaging (FR-SHL-01/02, §16). One codebase, every platform:
 *
 *   Windows  NSIS .exe (per-user) + .msi (machine-wide, Intune/GPO/RMM)
 *   macOS    universal .dmg + .pkg (Jamf/MDM) + .zip (what the updater installs)
 *   Linux    .AppImage (self-updating) + .deb + .rpm
 *
 * Signing is driven entirely by environment/CI secrets and never lives in
 * the repository:
 *   macOS    CSC_LINK / CSC_KEY_PASSWORD (Developer ID Application), and for
 *            notarization APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER
 *            or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
 *   Windows  WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD, or Azure Trusted Signing
 *            (AZURE_TRUSTED_SIGNING_* — the Q8 default in the SRS)
 *   Linux    GPG signing of packages happens in the repository pipeline
 *
 * An unsigned build still packages; it just cannot update itself (the
 * updater refuses to trust a publisher it cannot identify).
 */
const notarize = !!(process.env.APPLE_TEAM_ID || process.env.APPLE_API_KEY);
const azure = process.env.AZURE_TRUSTED_SIGNING_ACCOUNT
  ? {
      publisherName: process.env.AZURE_TRUSTED_SIGNING_PUBLISHER ?? 'Livezen Technologies',
      endpoint: process.env.AZURE_TRUSTED_SIGNING_ENDPOINT,
      codeSigningAccountName: process.env.AZURE_TRUSTED_SIGNING_ACCOUNT,
      certificateProfileName: process.env.AZURE_TRUSTED_SIGNING_PROFILE,
    }
  : undefined;

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'lk.worksuite.desktop',
  productName: 'WorkSuite',
  copyright: `Copyright © ${new Date().getFullYear()} Livezen Technologies LLC`,
  directories: { output: 'release/${version}', buildResources: 'build' },
  // pdfjs-dist is bundled into the renderer; its optional @napi-rs/canvas is
  // for Node only, and its one-arch binary breaks the universal mac merge.
  // Local AI (LAI-DSK-002): node-llama-cpp's native binaries load from outside the asar; the CUDA builds
  // (hundreds of MB) are left out — GPUs are used through Vulkan and Metal.
  files: ['out/**', 'package.json', '!**/*.map', '!node_modules/@napi-rs/**', '!node_modules/@node-llama-cpp/*cuda*/**'],
  // Text in images (worksuite-desktop#59): tesseract.js's worker thread is started from outside the asar, with the
  // packages it loads there (its WebAssembly core and their few dependencies).
  asarUnpack: [
    'node_modules/node-llama-cpp/**',
    'node_modules/@node-llama-cpp/**',
    'node_modules/{tesseract.js,tesseract.js-core,regenerator-runtime,is-url,bmp-js,wasm-feature-detect,zlibjs}/**',
  ],
  extraResources: [
    { from: 'resources/tray', to: 'tray' },
    { from: 'resources/icons', to: 'icons' },
  ],
  asar: true,
  // §3.3 / §13.2: RunAsNode off, NODE_OPTIONS off, --inspect off, only load
  // the app from its (integrity-checked) asar, cookies encrypted.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  },
  protocols: [{ name: 'WorkSuite link', schemes: ['worksuite'] }],
  // FR-DL-06: only WorkSuite's own reference file type; common formats are never claimed.
  fileAssociations: [{ ext: 'worksuite', name: 'WorkSuite reference', description: 'A link to a WorkSuite record', role: 'Viewer', mimeType: 'application/x-worksuite-reference' }],

  mac: {
    category: 'public.app-category.business',
    // The universal merge refuses a Mach-O file that is the same in the x64 and arm64 builds unless it is named
    // here. node-llama-cpp and @reflink ship each Mac's binaries as their own package (mac-arm64-metal, mac-x64;
    // reflink-darwin-arm64, -x64), installed in both builds and loaded by the one that matches at run time, so
    // they are one-arch files carried in both. (These are the lockfile's only darwin-only packages besides
    // @napi-rs, which is left out above.)
    x64ArchFiles: '**/node_modules/{node-llama-cpp,@node-llama-cpp,@reflink}/**',
    target: [
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] },
      { target: 'pkg', arch: ['universal'] },
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize,
    minimumSystemVersion: '12.0',
    extendInfo: {
      NSCameraUsageDescription: 'WorkSuite uses the camera only in video calls and meetings you join.',
      NSMicrophoneUsageDescription: 'WorkSuite uses the microphone only during calls and voice notes you record.',
      // Remote control types the controller's text through System Events, only while you let them control this Mac.
      NSAppleEventsUsageDescription: 'WorkSuite types text for someone you let control this Mac, and only while control lasts.',
      LSMultipleInstancesProhibited: true,
    },
  },
  dmg: { sign: false, title: 'WorkSuite ${version}' },
  pkg: { isRelocatable: false, allowAnywhere: false, allowCurrentUserHome: false, installLocation: '/Applications' },

  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'msi', arch: ['x64'] },
    ],
    ...(azure ? { azureSignOptions: azure } : {}),
    // Windows 10 22H2+ (NFR-CMP-01).
    requestedExecutionLevel: 'asInvoker',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'WorkSuite',
    deleteAppDataOnUninstall: false,
    artifactName: 'WorkSuite-Setup-${version}-${arch}.${ext}',
  },
  msi: {
    perMachine: true,
    oneClick: false,
    createDesktopShortcut: 'always',
    artifactName: 'WorkSuite-${version}-${arch}.${ext}',
  },

  linux: {
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
      { target: 'rpm', arch: ['x64', 'arm64'] },
    ],
    executableName: 'worksuite',
    category: 'Office',
    // Set to the real support mailbox before the first Linux release.
    maintainer: 'Livezen Technologies <noreply@worksuite.lk>',
    vendor: 'Livezen Technologies',
    synopsis: 'The WorkSuite desktop client',
    description: 'WorkSuite Desktop — mail, chat, tasks, files and every WorkSuite app on your desktop.',
    mimeTypes: ['x-scheme-handler/worksuite', 'application/x-worksuite-reference'],
    desktop: { entry: { StartupWMClass: 'WorkSuite' } },
    artifactName: 'WorkSuite-${version}-${arch}.${ext}',
  },
  // Remote control on X11: xdotool injects; xwininfo (x11-utils) tells a shared window from one covering it.
  deb: { depends: ['libsecret-1-0', 'libnotify4', 'libxss1', 'libnss3'], recommends: ['xdotool', 'x11-utils'] },
  rpm: { depends: ['libsecret', 'libnotify', 'libXScrnSaver', 'nss'] },

  // Releases are published by the pipeline with a signed manifest
  // (scripts/release-manifest.mjs), not by electron-updater feeds.
  publish: null,
};
