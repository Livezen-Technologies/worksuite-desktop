/**
 * The Office editor's page (`wsoffice://editor/index.html`), served only in
 * the editor's own partition (office-editor.ts). It loads the Document
 * Server's `api.js` and hands `new DocsAPI.DocEditor` the configuration
 * WorkSuite signed, unchanged, with the event handlers the tab asked for.
 *
 * It talks to the desktop only through `window.officeBridge` (the editor
 * preload): it reports the editor's events and takes a handful of
 * commands. It never sees a WorkSuite token, and nothing it sends is taken
 * on trust — the main process checks every event against its shape
 * (shared/office.ts `parseEditorEvent`).
 */

/**
 * What shows behind and around the editor while it loads or resizes (worksuite-desktop#326): the light and dark
 * greys of the editor's own themes, never white in dark mode. The view's native background is the same
 * (office-editor.ts), so a gap of a pixel or two while a window is resized is not seen.
 */
export const OFFICE_BACKGROUND = { light: '#f4f4f4', dark: '#333333' } as const;

export const OFFICE_HOST_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Office editor</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:${OFFICE_BACKGROUND.light}}html.dark,html.dark body{background:${OFFICE_BACKGROUND.dark};color-scheme:dark}#box{position:absolute;inset:0}#box>*{width:100%;height:100%;border:0}</style>
</head>
<body>
<div id="box"></div>
<script src="host.js"></script>
</body>
</html>
`;

/** Plain ES5-ish script: it runs before and beside the Document Server's own code in the page. */
export const OFFICE_HOST_JS = `(function () {
  'use strict';
  var bridge = window.officeBridge;
  if (!bridge) return;
  var editor = null;
  var apiUrl = null;
  var names = [];
  var loaded = false;
  var loading = false;
  var next = null;

  function send(type, data) {
    try { bridge.emit(type, data === undefined ? null : data); } catch (e) { /* the desktop is going away */ }
  }
  function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : undefined; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? Math.trunc(v) : undefined; }

  // Only what each event is for crosses: a mention's comment text never does.
  function dataOf(name, e) {
    var d = e && typeof e === 'object' && 'data' in e ? e.data : null;
    switch (name) {
      case 'onDocumentStateChange': return !!d;
      case 'onError': return d && typeof d === 'object' ? { errorCode: num(d.errorCode), errorDescription: str(d.errorDescription, 500) } : null;
      case 'onWarning': return d && typeof d === 'object' ? { warningCode: num(d.warningCode), warningDescription: str(d.warningDescription, 500) } : null;
      case 'onInfo': return d && typeof d === 'object' ? { mode: str(d.mode, 16) } : null;
      case 'onMetaChange': return d && typeof d === 'object' ? { title: str(d.title, 255), favorite: typeof d.favorite === 'boolean' ? d.favorite : undefined } : null;
      case 'onRequestRename': return str(d, 255) || '';
      case 'onRequestUsers': return d && typeof d === 'object' && typeof d.c === 'string' ? { c: d.c, search: str(d.search, 100) } : null;
      case 'onRequestSendNotify':
        return {
          emails: d && Array.isArray(d.emails) ? d.emails.filter(function (x) { return typeof x === 'string'; }).slice(0, 50) : [],
          actionLink: d && d.actionLink != null ? str(typeof d.actionLink === 'string' ? d.actionLink : JSON.stringify(d.actionLink), 4000) || null : null
        };
      default: return null;
    }
  }

  function handlers() {
    var ev = {};
    names.forEach(function (name) {
      ev[name] = function (e) { send(name, dataOf(name, e)); };
    });
    return ev;
  }

  function mount() {
    var box = document.getElementById('box');
    while (box.firstChild) box.removeChild(box.firstChild);
    var el = document.createElement('div');
    el.id = 'editor';
    box.appendChild(el);
  }

  function start(config) {
    if (editor) { try { editor.destroyEditor(); } catch (e) { /* already gone */ } editor = null; }
    mount();
    var cfg = {};
    for (var k in config) if (Object.prototype.hasOwnProperty.call(config, k) && k !== 'events') cfg[k] = config[k];
    cfg.events = handlers();
    try { editor = new window.DocsAPI.DocEditor('editor', cfg); } catch (e) { bridge.failed('init'); }
  }

  function load(then) {
    if (loaded) return then();
    next = then;
    if (loading || !apiUrl) return;
    loading = true;
    var s = document.createElement('script');
    s.src = apiUrl;
    s.async = true;
    s.onload = function () {
      loading = false;
      if (!window.DocsAPI || typeof window.DocsAPI.DocEditor !== 'function') { bridge.failed('api'); return; }
      loaded = true;
      var run = next; next = null;
      if (run) run();
    };
    s.onerror = function () { loading = false; bridge.failed('load'); };
    document.head.appendChild(s);
  }

  function sinhala(action) {
    var frame = document.querySelector('#box iframe');
    var origin = null;
    try { origin = new URL(apiUrl).origin; } catch (e) { origin = null; }
    if (!frame || !frame.contentWindow || !origin) return;
    frame.contentWindow.postMessage(JSON.stringify({
      type: 'onExternalPluginMessage',
      data: { type: 'worksuite.sinhala', guid: 'asc.{B50BAEE2-4EAC-4298-9DD2-73CC3223FFFA}', action: action }
    }), origin);
  }

  // The view follows its placeholder (setBounds), which resizes this window: the editor is told, where it can be (#326).
  window.addEventListener('resize', function () {
    if (editor && typeof editor.resize === 'function') { try { editor.resize(); } catch (e) { /* not ready yet */ } }
  });

  bridge.onCommand(function (cmd) {
    if (!cmd || typeof cmd !== 'object') return;
    switch (cmd.type) {
      case 'init': apiUrl = cmd.apiUrl; names = cmd.events || []; break;
      case 'start': if (cmd.events) names = cmd.events; load(function () { start(cmd.config); }); break;
      case 'refresh':
        if (editor && typeof editor.refreshFile === 'function') editor.refreshFile(cmd.config);
        else load(function () { start(cmd.config); });
        break;
      case 'setUsers': if (editor && typeof editor.setUsers === 'function') editor.setUsers({ c: cmd.c, users: cmd.users }); break;
      case 'denyEditingRights': if (editor && typeof editor.denyEditingRights === 'function') editor.denyEditingRights(cmd.message); break;
      case 'showMessage': if (editor && typeof editor.showMessage === 'function') editor.showMessage(cmd.message); break;
      // Sinhala Tools: the action goes to the editor's frame, and only to the Document Server's origin; the plugin
      // (asc.{B50BAEE2-…}) takes it as an external plugin message. Nothing runs in this page.
      case 'sinhala.convertSelection':
      case 'sinhala.convertDocument': sinhala(cmd.type.slice(8)); break;
      // The app's light or dark mode, for the page behind the editor (#326); the editor's own theme is in its signed config.
      case 'theme': document.documentElement.className = cmd.dark ? 'dark' : ''; break;
      case 'destroy': if (editor) { try { editor.destroyEditor(); } catch (e) { /* already gone */ } editor = null; } break;
    }
  });
  bridge.ready();
})();
`;
