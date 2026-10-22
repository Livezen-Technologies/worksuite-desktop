// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemplateGallery, matchesTemplate } from '../../../src/modules/marketing/email-gallery';
import type { Starter } from '../../../src/modules/marketing/types';

/**
 * Marketing › Email › Templates: the gallery of starters and system templates
 * filters by kind and searches, previews in a sandbox, and only offers to make
 * a template to somebody who may write one.
 */
const starter = (over: Partial<Starter>): Starter => ({
  key: 'k', name: 'N', category: 'newsletter', subject: 'S', preheader: 'P', body_html: '<div data-block="text"><p>Hi</p></div>',
  source: 'library', subcategory: 'monthly_digest', subcategory_label: 'Monthly digest', ...over,
});

const LIST = [
  starter({ key: 'letter', name: 'A letter', source: 'starter', subcategory: null, subcategory_label: null }),
  starter({ key: 'newsletter-monthly-digest', name: 'Monthly digest' }),
  starter({ key: 'promo-black-friday', name: 'Black Friday', category: 'promotion', subcategory: 'black_friday', subcategory_label: 'Black Friday', subject: 'Our biggest sale' }),
  starter({ key: 'promo-coupon', name: 'Coupon code', category: 'promotion', subcategory: 'coupon', subcategory_label: 'Coupon' }),
];

afterEach(cleanup);

describe('TemplateGallery', () => {
  it('switches kind, searches and hands back the template chosen', () => {
    const onUse = vi.fn();
    render(<TemplateGallery starters={LIST} onUse={onUse} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(screen.getByRole('tab', { name: /Promotional 2/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: /Basic 1/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: /All 4/ }));

    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'biggest' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Make a template from it' }));
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ key: 'promo-black-friday' }));

    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'nothing like it' } });
    expect(screen.getByText(/No template matches/)).toBeTruthy();
  });

  it('previews in a sandbox, and offers nothing to make without the right', () => {
    render(<TemplateGallery starters={LIST} />);

    expect(screen.queryByRole('button', { name: 'Make a template from it' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[1]!);
    expect(screen.getByTitle('Preview of Monthly digest').getAttribute('sandbox')).toBe('');
  });

  it('needs every word somewhere', () => {
    expect(matchesTemplate(LIST[2]!, 'black sale')).toBe(true);
    expect(matchesTemplate(LIST[2]!, 'black coupon')).toBe(false);
  });
});
