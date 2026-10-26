/* global ObjC, $, Ref, delay */
/* eslint-disable @typescript-eslint/no-unused-vars -- run() is what osascript calls */
// TEMPORARY diagnostic for the macOS helper (removed once the helper is fixed): which way of putting characters on a
// posted key event the JXA bridge honours, and what is listed at a point. Run by check.mjs with the text box focused.
ObjC.import('Foundation'); ObjC.import('CoreGraphics'); ObjC.import('AppKit');
function run(argv) {
  var mode = argv[0], out = [];
  function post(e) { $.CGEventSetFlags(e, 0); $.CGEventPost(0, e); }
  function cps(s) { var r = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { r.push(s.slice(i, i + 2)); i++; } else r.push(s[i]); } return r; }
  if (mode === 'at') {
    var px = +argv[1], py = +argv[2];
    var H = null; try { H = $.NSScreen.screens.objectAtIndex(0).frame.size.height; } catch (e) { out.push('screen err ' + e); }
    out.push('screenH=' + H);
    try { var app = $.NSApplication.sharedApplication; out.push('app up ' + !!app); } catch (e) { out.push('app err ' + e); }
    try { out.push('hitFlipped=' + $.NSWindow.windowNumberAtPointBelowWindowWithWindowNumber($.CGPointMake(px, H - py), 0)); } catch (e) { out.push('hitFlipped err ' + e); }
    try { out.push('hitRaw=' + $.NSWindow.windowNumberAtPointBelowWindowWithWindowNumber($.CGPointMake(px, py), 0)); } catch (e) { out.push('hitRaw err ' + e); }
    var all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(17, 0))) || [];
    for (var j = 0; j < all.length; j++) {
      var w = all[j], b = w.kCGWindowBounds;
      if (b && px >= b.X && px < b.X + b.Width && py >= b.Y && py < b.Y + b.Height) out.push(JSON.stringify({ n: w.kCGWindowNumber, owner: w.kCGWindowOwnerName, pid: w.kCGWindowOwnerPID, layer: w.kCGWindowLayer, alpha: w.kCGWindowAlpha, name: w.kCGWindowName, b: b }));
    }
    return out.join('\n');
  }
  var list = cps(argv[1]);
  for (var k = 0; k < list.length; k++) {
    var s = list[k];
    for (var d = 0; d < 2; d++) {
      var down = d === 0;
      try {
        if (mode === 'js') { var e = $.CGEventCreateKeyboardEvent(null, 0, down); $.CGEventKeyboardSetUnicodeString(e, s.length, s); post(e); }
        else if (mode === 'data') { var e2 = $.CGEventCreateKeyboardEvent(null, 0, down); var data = $(s).dataUsingEncoding(0x94000100); $.CGEventKeyboardSetUnicodeString(e2, data.length / 2, data.bytes); post(e2); }
        else if (mode === 'ref') { if (s.length !== 1) continue; var e3 = $.CGEventCreateKeyboardEvent(null, 0, down); var r = Ref('S'); r[0] = s.charCodeAt(0); $.CGEventKeyboardSetUnicodeString(e3, 1, r); post(e3); }
        else if (mode === 'ref2arr') { var e4 = $.CGEventCreateKeyboardEvent(null, 0, down); var r2 = Ref('[2S]'); r2[0] = s.charCodeAt(0); if (s.length > 1) r2[1] = s.charCodeAt(1); $.CGEventKeyboardSetUnicodeString(e4, s.length, r2); post(e4); }
        else if (mode === 'refpair') { for (var u = 0; u < s.length; u++) { var e5 = $.CGEventCreateKeyboardEvent(null, 0, down); var r5 = Ref('S'); r5[0] = s.charCodeAt(u); $.CGEventKeyboardSetUnicodeString(e5, 1, r5); post(e5); } }
        else if (mode === 'refI') { var e6 = $.CGEventCreateKeyboardEvent(null, 0, down); var r6 = Ref('I'); r6[0] = s.length > 1 ? (s.charCodeAt(0) + s.charCodeAt(1) * 65536) : s.charCodeAt(0); $.CGEventKeyboardSetUnicodeString(e6, s.length, r6); post(e6); }
        else if (mode === 'nsevent') { var ev = $.NSEvent.keyEventWithTypeLocationModifierFlagsTimestampWindowNumberContextCharactersCharactersIgnoringModifiersIsARepeatKeyCode(down ? 10 : 11, { x: 0, y: 0 }, 0, 0, 0, $(), $(s), $(s), false, 0); var cg = ev.CGEvent; post(cg); }
      } catch (err) { out.push(mode + ' err ' + err); }
      delay(0.02);
    }
  }
  return out.join('\n') || 'posted';
}
