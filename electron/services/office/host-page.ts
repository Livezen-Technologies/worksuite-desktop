import { createHash } from 'node:crypto';

/**
 * The page the editor view shows (app://office/host.html): an empty element
 * and one inline script that loads the Document Server's editor script and
 * hands `DocsAPI.DocEditor` the configuration WorkSuite signed, exactly as it
 * came. It knows nothing of WorkSuite: it takes commands from, and passes the
 * editor's events to, `window.officeHost` (the view's preload), and nothing
 * else. Its policy lets it load and frame the Document Server's origin only;
 * the script itself is allowed by its hash.
 *
 * `new DocsAPI.DocEditor(id)` replaces the element with that id by its
 * iframe, so each build gets a placeholder of its own inside #root.
 */
export const HOST_SCRIPT = `(function () {
  'use strict';
  var host = window.officeHost;
  var editor = null;
  var current = 0;
  var loadedUrl = null;
  var root = document.getElementById('root');

  function destroy() {
    try { if (editor && editor.destroyEditor) editor.destroyEditor(); } catch (e) { /* gone with its frame */ }
    editor = null;
    root.textContent = '';
  }

  function withScript(url, build, then) {
    if (window.DocsAPI && loadedUrl === url) { then(); return; }
    var s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = function () { loadedUrl = url; then(); };
    s.onerror = function () { s.remove(); if (build === current) host.emit(build, 'scriptError', null); };
    document.head.appendChild(s);
  }

  function load(cmd) {
    destroy();
    current = cmd.build;
    withScript(cmd.apiUrl, cmd.build, function () {
      if (cmd.build !== current || !window.DocsAPI) return;
      var place = document.createElement('div');
      place.id = 'editor-' + cmd.build;
      place.style.height = '100%';
      root.appendChild(place);
      var events = {};
      cmd.events.forEach(function (name) {
        events[name] = function (e) {
          var data = e && e.data !== undefined ? e.data : null;
          try { host.emit(cmd.build, name, JSON.parse(JSON.stringify(data))); } catch (x) { host.emit(cmd.build, name, null); }
        };
      });
      var config = {};
      for (var k in cmd.config) if (Object.prototype.hasOwnProperty.call(cmd.config, k)) config[k] = cmd.config[k];
      config.events = events;
      editor = new window.DocsAPI.DocEditor(place.id, config);
    });
  }

  host.onCommand(function (cmd) {
    if (!cmd || typeof cmd.op !== 'string') return;
    if (cmd.op === 'load') load(cmd);
    else if (cmd.op === 'destroy') { current++; destroy(); }
    else if (cmd.op === 'refreshFile' && editor && editor.refreshFile) editor.refreshFile(cmd.config);
    else if (cmd.op === 'setUsers' && editor && editor.setUsers) editor.setUsers(cmd.data);
    else if (cmd.op === 'downloadAs' && editor && editor.downloadAs) editor.downloadAs(cmd.format);
  });
  host.ready();
})();`;

const HOST_SCRIPT_HASH = `'sha256-${createHash('sha256').update(HOST_SCRIPT, 'utf8').digest('base64')}'`;

export function hostPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>WorkSuite Office</title><style>html,body,#root{margin:0;height:100%;overflow:hidden;background:#fff}</style></head><body><div id="root"></div><script>${HOST_SCRIPT}</script></body></html>`;
}

/**
 * The editor view's Content-Security-Policy: its own script by hash, the
 * Document Server's origin for the editor script, its frame and what the
 * editor fetches, and nothing else — no other site, no form, no plug-in.
 */
export function hostPolicy(documentServer: string): string {
  return [
    "default-src 'none'",
    `script-src ${HOST_SCRIPT_HASH} ${documentServer}`,
    "style-src 'unsafe-inline'",
    `frame-src ${documentServer}`,
    `connect-src ${documentServer}`,
    `img-src data: ${documentServer}`,
    `font-src ${documentServer}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
