import { describe, expect, it } from 'vitest';
import { isSlidesConfig, planShow, presentKey, showHash } from '../../../electron/services/slideshow';

const d = (id: number, width: number, height: number, x = 0) => ({ id, bounds: { x, y: 0, width, height } });

describe('#321 where a slideshow goes', () => {
  it('with one screen, the slides fill it and there is no presenter view', () => {
    expect(planShow([d(1, 1440, 900)], 1, 1)).toEqual({ slides: 1, presenter: null });
    expect(planShow([d(1, 1440, 900)], null, 1)).toEqual({ slides: 1, presenter: null });
  });

  it('with a second screen, the slides fill the other one and the presenter view takes the screen the app is on', () => {
    const laptop = d(1, 1512, 982);
    const projector = d(2, 1920, 1080, 1512);
    expect(planShow([laptop, projector], 1, 1)).toEqual({ slides: 2, presenter: 1 });
    // The app moved to the external screen: the slides go to the laptop's.
    expect(planShow([laptop, projector], 2, 1)).toEqual({ slides: 1, presenter: 2 });
  });

  it('picks the largest other screen, and leaves out the presenter view when not wanted', () => {
    const screens = [d(1, 1440, 900), d(2, 1280, 720, 1440), d(3, 3840, 2160, 2720)];
    expect(planShow(screens, 1, 1)).toEqual({ slides: 3, presenter: 1 });
    expect(planShow(screens, 1, 1, false)).toEqual({ slides: 3, presenter: null });
  });

  it('a window on a screen that went away counts as the primary one; no screens, no show', () => {
    expect(planShow([d(1, 1440, 900), d(2, 1920, 1080, 1440)], 99, 1)).toEqual({ slides: 2, presenter: 1 });
    expect(planShow([], 1, 1)).toBeNull();
  });

  it('opens the windows at their own addresses', () => {
    expect(showHash('slideshow', 'abcdefgh12')).toBe('/window/slideshow?id=abcdefgh12');
    expect(showHash('presenter', 'abcdefgh12')).toBe('/window/presenter?id=abcdefgh12');
  });
});

describe('#321 Present from the editor', () => {
  const key = (k: string, m: Partial<{ control: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({ key: k, control: false, meta: false, shift: false, alt: false, ...m });

  it('takes ⌘⏎ / F5 (⇧ for the current slide) only in a presentation', () => {
    expect(isSlidesConfig({ documentType: 'slide' })).toBe(true);
    expect(isSlidesConfig({ documentType: 'presentation' })).toBe(true);
    expect(isSlidesConfig({ documentType: 'word' })).toBe(false);
    expect(isSlidesConfig(null)).toBe(false);
    expect(presentKey(key('Enter', { meta: true }), 'darwin')).toEqual({ fromCurrent: false });
    expect(presentKey(key('Enter', { meta: true, shift: true }), 'darwin')).toEqual({ fromCurrent: true });
    expect(presentKey(key('Enter', { control: true }), 'win32')).toEqual({ fromCurrent: false });
    expect(presentKey(key('Enter', { control: true }), 'darwin')).toBeNull();
    expect(presentKey(key('F5'), 'linux')).toEqual({ fromCurrent: false });
    expect(presentKey(key('F5', { shift: true }), 'linux')).toEqual({ fromCurrent: true });
    expect(presentKey(key('Enter'), 'linux')).toBeNull();
    expect(presentKey(key('F5', { alt: true }), 'linux')).toBeNull();
  });
});
