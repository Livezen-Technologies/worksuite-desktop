import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux' }));

const fit = await import('../../../src/modules/office/slides/fit');
const keys = await import('../../../src/modules/office/slides/keys');
const deck = await import('../../../src/modules/office/slides/deck');
const timer = await import('../../../src/modules/office/slides/timer');
const protocol = await import('../../../src/modules/office/slides/protocol');
const { isSlidesFile } = await import('../../../src/modules/office/slides/overlay');
const { viewKind } = await import('../../../src/components/FileViewer');
const { contract } = await import('../../../shared/ipc/contract');
const { INVOKE_CHANNELS } = await import('../../../shared/ipc/channels');

const WIDE = { width: 1280, height: 720 };
const SQUARE = { width: 960, height: 720 };

describe('#321 fitting a slide into the window', () => {
  it('"Fit slide" shows the whole slide, centred, at its own aspect (16:9 and 4:3)', () => {
    const area = { width: 1048, height: 600 };
    const b = fit.slideBox(area, WIDE, 'fit');
    // Height-limited: 600 − 2×24 = 552 tall, 16:9 wide.
    expect(b.height).toBe(552);
    expect(b.width).toBe(Math.round(552 * (16 / 9)));
    expect(b.left).toBe(Math.round((1048 - b.width) / 2));
    expect(b.top).toBe(24);
    expect(b.contentWidth).toBe(1048);
    expect(b.contentHeight).toBe(600);

    const tall = fit.slideBox({ width: 700, height: 900 }, SQUARE, 'fit');
    expect(tall.width).toBe(652);
    expect(tall.height).toBe(Math.round(652 * 0.75));
    expect(tall.top).toBe(Math.round((900 - tall.height) / 2));
  });

  it('"Fit width" fills the width and the area scrolls to the rest — never cropped, never off to one side', () => {
    const area = { width: 1048, height: 400 };
    const b = fit.slideBox(area, WIDE, 'width');
    expect(b.width).toBe(1000);
    expect(b.left).toBe(24);
    expect(b.contentHeight).toBe(b.height + 48);
    expect(b.top).toBe(24);
  });

  it('a fixed zoom is 50–200% of the slide, and a slide bigger than the area is scrolled to, not cut off', () => {
    const area = { width: 800, height: 500 };
    expect(fit.slideScale(area, WIDE, 2)).toBe(2);
    expect(fit.slideScale(area, WIDE, 9)).toBe(2);
    expect(fit.slideScale(area, WIDE, 0.1)).toBe(0.5);
    const b = fit.slideBox(area, WIDE, 2);
    expect(b.width).toBe(2560);
    expect(b.left).toBe(24);
    expect(b.contentWidth).toBe(2560 + 48);
    const small = fit.slideBox(area, WIDE, 0.5);
    expect(small.left).toBe(Math.round((800 - 640) / 2));
  });

  it('re-fits as the space changes (a panel or the chat drawer opening)', () => {
    const before = fit.slideBox({ width: 1400, height: 800 }, WIDE, 'fit');
    const after = fit.slideBox({ width: 1000, height: 800 }, WIDE, 'fit');
    expect(after.width).toBeLessThan(before.width);
    expect(after.width / after.height).toBeCloseTo(16 / 9, 1);
  });

  it('a full screen takes the slide edge to edge at its aspect, black round it', () => {
    const b = fit.screenBox({ width: 1440, height: 900 }, WIDE);
    expect(b.width).toBe(1440);
    expect(b.height).toBe(810);
    expect(b.top).toBe(45);
    expect(fit.screenBox({ width: 1920, height: 1080 }, SQUARE)).toMatchObject({ width: 1440, height: 1080, left: 240, top: 0 });
  });

  it('⌘+ / ⌘− step through 50–200% from what is on screen, and the menu round-trips', () => {
    expect(fit.stepZoom(0.83, 1)).toBe(1);
    expect(fit.stepZoom(0.83, -1)).toBe(0.75);
    expect(fit.stepZoom(2, 1)).toBe(2);
    expect(fit.stepZoom(0.5, -1)).toBe(0.5);
    expect(fit.zoomLabel('fit')).toBe('Fit slide');
    expect(fit.zoomLabel('width')).toBe('Fit width');
    expect(fit.zoomLabel(1.5)).toBe('150%');
    for (const z of ['fit', 'width', 0.5, 1, 2] as const) expect(fit.parseZoom(fit.zoomValue(z))).toBe(z);
    expect(fit.parseZoom('nonsense')).toBe('fit');
  });

  it('says the aspect, and sizes the canvas at the screen’s pixel ratio (2× on Retina) within a memory cap', () => {
    expect(fit.aspectLabel(WIDE)).toBe('16:9');
    expect(fit.aspectLabel(SQUARE)).toBe('4:3');
    expect(fit.backingSize({ width: 800, height: 450 }, 2)).toEqual({ width: 1600, height: 900 });
    expect(fit.backingSize({ width: 800, height: 450 }, 1)).toEqual({ width: 800, height: 450 });
    const capped = fit.backingSize({ width: 8000, height: 4500 }, 2);
    expect(capped.width * capped.height).toBeLessThanOrEqual(4096 * 4096);
    expect(capped.width / capped.height).toBeCloseTo(16 / 9, 2);
  });
});

describe('#321 the viewer’s and the slideshow’s keys', () => {
  const k = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({ key, ...mods });

  it('← → ↑ ↓ / Page Up / Page Down / Space change slides; Home and End go to the first and last', () => {
    expect(['ArrowRight', 'ArrowDown', 'PageDown', ' '].map((x) => keys.viewerAction(k(x), false))).toEqual(Array(4).fill({ type: 'next' }));
    expect(['ArrowLeft', 'ArrowUp', 'PageUp'].map((x) => keys.viewerAction(k(x), false))).toEqual(Array(3).fill({ type: 'prev' }));
    expect(keys.viewerAction(k(' ', { shiftKey: true }), false)).toEqual({ type: 'prev' });
    expect(keys.viewerAction(k('Home'), false)).toEqual({ type: 'first' });
    expect(keys.viewerAction(k('End'), false)).toEqual({ type: 'last' });
    expect(keys.viewerAction(k('a'), false)).toBeNull();
  });

  it('⌘+ ⌘− ⌘0 zoom on a Mac, Ctrl elsewhere', () => {
    expect(keys.viewerAction(k('=', { metaKey: true }), true)).toEqual({ type: 'zoomIn' });
    expect(keys.viewerAction(k('-', { metaKey: true }), true)).toEqual({ type: 'zoomOut' });
    expect(keys.viewerAction(k('0', { metaKey: true }), true)).toEqual({ type: 'zoomReset' });
    expect(keys.viewerAction(k('+', { ctrlKey: true }), false)).toEqual({ type: 'zoomIn' });
    // Ctrl on a Mac is not the command key; ⌘+→ is the system's.
    expect(keys.viewerAction(k('=', { ctrlKey: true }), true)).toBeNull();
    expect(keys.viewerAction(k('ArrowRight', { metaKey: true }), true)).toBeNull();
  });

  it('⌘⏎ or F5 present from the start; ⇧⌘⏎ or ⇧F5 from the current slide', () => {
    expect(keys.viewerAction(k('Enter', { metaKey: true }), true)).toEqual({ type: 'present', fromCurrent: false });
    expect(keys.viewerAction(k('Enter', { metaKey: true, shiftKey: true }), true)).toEqual({ type: 'present', fromCurrent: true });
    expect(keys.viewerAction(k('Enter', { ctrlKey: true }), false)).toEqual({ type: 'present', fromCurrent: false });
    expect(keys.viewerAction(k('F5'), false)).toEqual({ type: 'present', fromCurrent: false });
    expect(keys.viewerAction(k('F5', { shiftKey: true }), true)).toEqual({ type: 'present', fromCurrent: true });
    expect(keys.presentShortcut(k('Enter'), true)).toBeNull();
  });

  it('in the slideshow: → / Space / Enter next, ← / Backspace back, Esc ends, L the laser pointer, B black', () => {
    expect(keys.showAction(k('ArrowRight'))).toEqual({ type: 'next' });
    expect(keys.showAction(k(' '))).toEqual({ type: 'next' });
    expect(keys.showAction(k('Enter'))).toEqual({ type: 'next' });
    expect(keys.showAction(k('ArrowLeft'))).toEqual({ type: 'prev' });
    expect(keys.showAction(k('Backspace'))).toEqual({ type: 'prev' });
    expect(keys.showAction(k('Escape'))).toEqual({ type: 'exit' });
    expect(keys.showAction(k('l'))).toEqual({ type: 'laser' });
    expect(keys.showAction(k('b'))).toEqual({ type: 'black' });
    expect(keys.showAction(k('q', { metaKey: true }))).toBeNull();
  });

  it('a key typed into a field is the field’s', () => {
    expect(keys.typingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(keys.typingTarget({ tagName: 'div', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(keys.typingTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(keys.typingTarget(null)).toBe(false);
  });
});

describe('#321 moving through a deck', () => {
  it('stays inside the deck', () => {
    expect(deck.moveSlide(0, 8, 'prev')).toBe(0);
    expect(deck.moveSlide(7, 8, 'next')).toBe(7);
    expect(deck.moveSlide(3, 8, 'next')).toBe(4);
    expect(deck.moveSlide(3, 8, 'first')).toBe(0);
    expect(deck.moveSlide(3, 8, 'last')).toBe(7);
    expect(deck.clampSlide(99, 8)).toBe(7);
    expect(deck.clampSlide(-1, 8)).toBe(0);
    expect(deck.clampSlide(2, 0)).toBe(0);
  });

  it('labels the slide, starts a show from the start or here, and knows the next slide and the notes', () => {
    expect(deck.slideLabel(0, 8)).toBe('Slide 1 of 8');
    expect(deck.slideLabel(0, 0)).toBe('No slides');
    expect(deck.startSlide(4, 8, false)).toBe(0);
    expect(deck.startSlide(4, 8, true)).toBe(4);
    expect(deck.nextSlide(6, 8)).toBe(7);
    expect(deck.nextSlide(7, 8)).toBeNull();
    expect(deck.noteText(['Say hello', '  '], 0)).toBe('Say hello');
    expect(deck.noteText(['Say hello', '  '], 1)).toBe('No speaker notes');
    expect(deck.noteText([], 3)).toBe('No speaker notes');
  });
});

describe('#321 the presenter view’s timer and clock, and the control bar', () => {
  it('counts, pauses, resumes and resets', () => {
    let t = timer.timerStart(1000);
    expect(timer.timerElapsed(t, 61_000)).toBe(60_000);
    t = timer.timerPause(t, 61_000);
    expect(timer.timerElapsed(t, 500_000)).toBe(60_000);
    t = timer.timerResume(t, 500_000);
    expect(timer.timerElapsed(t, 505_000)).toBe(65_000);
    expect(timer.timerElapsed(timer.timerReset(505_000, true), 506_000)).toBe(1000);
    expect(timer.timerElapsed(timer.timerReset(505_000, false), 900_000)).toBe(0);
  });

  it('reads as mm:ss, h:mm:ss past an hour, and the clock as the system has it', () => {
    expect(timer.formatElapsed(0)).toBe('00:00');
    expect(timer.formatElapsed(247_900)).toBe('04:07');
    expect(timer.formatElapsed(3_729_000)).toBe('1:02:09');
    const d = new Date(2026, 9, 10, 14, 5);
    expect(timer.formatClock(d)).toBe('14:05');
    expect(timer.formatClock(d, true)).toBe('2:05 PM');
    expect(timer.formatClock(new Date(2026, 9, 10, 0, 7), true)).toBe('12:07 AM');
  });

  it('shows the control bar when the mouse moves and fades it after two seconds, unless the pointer is on it', () => {
    expect(timer.controlsShown(null, 5000)).toBe(false);
    expect(timer.controlsShown(5000, 6999)).toBe(true);
    expect(timer.controlsShown(5000, 7000)).toBe(false);
    expect(timer.controlsShown(5000, 90_000, true)).toBe(true);
  });
});

describe('#321 the slideshow windows’ messages', () => {
  it('takes only well-formed messages', () => {
    expect(protocol.parseShowMessage({ t: 'hello', role: 'show' })).toEqual({ t: 'hello', role: 'show' });
    expect(protocol.parseShowMessage({ t: 'hello', role: 'boss' })).toBeNull();
    expect(protocol.parseShowMessage({ t: 'goto', index: 3 })).toEqual({ t: 'goto', index: 3 });
    expect(protocol.parseShowMessage({ t: 'goto', index: -1 })).toBeNull();
    expect(protocol.parseShowMessage({ t: 'goto', index: 1.5 })).toBeNull();
    expect(protocol.parseShowMessage({ t: 'laser', x: 0.5, y: 1 })).toEqual({ t: 'laser', x: 0.5, y: 1 });
    expect(protocol.parseShowMessage({ t: 'laser', x: 2, y: 0 })).toBeNull();
    expect(protocol.parseShowMessage({ t: 'deck', name: 'Q3.pptx', bytes: new Uint8Array([1, 2]), index: 0 })).toMatchObject({ t: 'deck', name: 'Q3.pptx', index: 0 });
    expect(protocol.parseShowMessage({ t: 'deck', name: 'x', bytes: 'not bytes', index: 0 })).toBeNull();
    expect(protocol.parseShowMessage({ t: 'black', on: 'yes' })).toBeNull();
    expect(protocol.parseShowMessage({ t: 'end', index: 2 })).toEqual({ t: 'end', index: 2 });
    expect(protocol.parseShowMessage('end')).toBeNull();
    expect(protocol.parseShowMessage(null)).toBeNull();
  });

  it('finds the show and its role in the window’s address', () => {
    expect(protocol.showFromHash('#/window/slideshow?id=0b6e3c1a-1111-4c6d-9f00-5a0e6b1c2d3e')).toEqual({ id: '0b6e3c1a-1111-4c6d-9f00-5a0e6b1c2d3e', role: 'show' });
    expect(protocol.showFromHash('#/window/presenter?id=abcdefgh12')).toEqual({ id: 'abcdefgh12', role: 'presenter' });
    expect(protocol.showFromHash('#/window/slideshow?id=../../x')).toBeNull();
    expect(protocol.showFromHash('#/window/record?route=/files')).toBeNull();
    expect(protocol.channelName('abcdefgh12')).toBe('ws-slides:abcdefgh12');
  });

  it('the main process opens a show only for a well-formed id', () => {
    expect(INVOKE_CHANNELS).toContain('slides:present');
    expect(INVOKE_CHANNELS).toContain('slides:close');
    expect(contract['slides:present'].input.safeParse({ id: 'abcdefgh12', presenter: true }).success).toBe(true);
    expect(contract['slides:present'].input.safeParse({ id: 'x' }).success).toBe(false);
    expect(contract['slides:present'].input.safeParse({ id: '../../../etc/passwd' }).success).toBe(false);
  });
});

describe('#321 the same viewer everywhere', () => {
  it('a .pptx is a presentation in Files, Chat, Mail and Tenders; older formats open as before', () => {
    expect(isSlidesFile('Board deck.PPTX')).toBe(true);
    expect(isSlidesFile('old.ppt')).toBe(false);
    expect(isSlidesFile('notes.odp')).toBe(false);
    expect(viewKind('Q3.pptx', null)).toBe('slides');
    expect(viewKind('download', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('slides');
    expect(viewKind('a.pdf', null)).toBe('pdf');
    expect(viewKind('a.docx', null)).toBe('other');
  });
});
