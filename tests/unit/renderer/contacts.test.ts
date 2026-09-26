// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SOCIAL, addressOf, birthdayOf, bodyOf, formOf, matches, pillOf, subLine, typeOf, type ContactDetail } from '../../../src/modules/contacts/api';

const dinuka: ContactDetail = {
  id: 7,
  user_id: null,
  type: 'customer',
  display_name: 'Dinuka Fernando',
  first_name: 'Dinuka',
  last_name: 'Fernando',
  job_title: 'Procurement lead',
  department: 'Procurement',
  company: 'CreativeFX',
  work_email: 'dinuka@creativefx.lk',
  personal_email: null,
  email: 'dinuka@creativefx.lk',
  mobile: '+94 77 234 5678',
  office_phone: null,
  phone: '+94 77 234 5678',
  avatar_color: '#0E7C86',
  labels: ['VIP', 'Prospect'],
  is_favorite: true,
  is_archived: false,
  home_phone: null,
  website: 'creativefx.lk',
  birthday: '1988-10-14',
  gender: null,
  country: 'Sri Lanka',
  state: 'Western',
  city: 'Colombo 07',
  zip: '00700',
  street: '12 Flower Rd',
  customer_id: 'CUS-0418',
  employee_id: null,
  vendor_id: null,
  tax_number: null,
  notes: 'Prefers WhatsApp in the mornings.',
  social: { linkedin: 'in/dinukaf', whatsapp: '+94 77 234 5678' },
  created_at: '2026-09-02 09:14:00',
  groups: [{ id: 3, name: 'Key accounts', color: '#E0522F' }],
};

describe('the contact form', () => {
  it('starts from the contact, with the name left to work itself out when it matches', () => {
    const f = formOf(dinuka);
    expect(f.display_name).toBe('');
    expect(f.labels).toBe('VIP, Prospect');
    expect(f.group_ids).toEqual([3]);
    expect(f.social.linkedin).toBe('in/dinukaf');
    expect(f.social.github).toBe('');
    expect(f.birthday).toBe('1988-10-14');
    expect(formOf({ ...dinuka, display_name: 'Dinu' }).display_name).toBe('Dinu');
  });

  it('a new one takes the defaults it is given', () => {
    const f = formOf(null, { type: 'vendor', group_ids: [9] });
    expect(f.type).toBe('vendor');
    expect(f.group_ids).toEqual([9]);
    expect(f.first_name).toBe('');
  });

  it('saves the name from first and last, labels as a string, and every social field there is', () => {
    const body = bodyOf({ ...formOf(dinuka), first_name: ' Dinuka ', social: { ...formOf(dinuka).social, x: '  ', github: ' dinuka ' } });
    expect(body.display_name).toBe('Dinuka Fernando');
    expect(body.first_name).toBe('Dinuka');
    expect(body.labels).toBe('VIP, Prospect');
    expect(body.social).toEqual({ linkedin: 'in/dinukaf', whatsapp: '+94 77 234 5678', github: 'dinuka' });
    expect(body.group_ids).toEqual([3]);
    // Cleared social links still go up (as nothing), so the server forgets them.
    expect(bodyOf({ ...formOf(dinuka), social: {} }).social).toEqual({});
  });
});

describe('showing a contact', () => {
  it('says what they do and where, or how to reach them', () => {
    expect(subLine(dinuka)).toBe('Procurement lead · CreativeFX');
    expect(subLine({ job_title: null, company: null, email: 'tharindu.h@gmail.com' })).toBe('tharindu.h@gmail.com');
    expect(subLine({ job_title: null, company: null, email: null, phone: '+94 77 000 1122' })).toBe('+94 77 000 1122');
    expect(subLine({ job_title: null, company: null, email: null })).toBe('—');
  });

  it('writes the address in one line and the birthday as a day of the year', () => {
    expect(addressOf(dinuka)).toBe('12 Flower Rd, Colombo 07, Western 00700, Sri Lanka');
    expect(addressOf({ street: null, city: 'Kandy', state: null, zip: null, country: null })).toBe('Kandy');
    expect(birthdayOf('1988-10-14')).toBe('14 October');
    expect(birthdayOf(null)).toBe('');
  });

  it('calls a personal contact just a contact, and knows every type', () => {
    expect(pillOf('personal')).toBe('Contact');
    expect(pillOf('customer')).toBe('Customer');
    expect(typeOf('nonsense').id).toBe('personal');
  });

  it('turns a handle into the address of the profile', () => {
    const url = (k: string, v: string) => SOCIAL.find((s) => s.key === k)!.url(v);
    expect(url('linkedin', 'in/dinukaf')).toBe('https://www.linkedin.com/in/dinukaf');
    expect(url('x', '@dinuka')).toBe('https://x.com/dinuka');
    expect(url('whatsapp', '+94 77 234 5678')).toBe('https://wa.me/94772345678');
    expect(url('github', 'https://github.com/dinuka')).toBe('https://github.com/dinuka');
    expect(url('youtube', 'creativefx')).toBe('https://www.youtube.com/@creativefx');
  });
});

describe('searching contacts', () => {
  it('looks where the server looks: names, emails, company, title, phones and labels', () => {
    for (const term of ['dinuka', 'fernando', 'creativefx', 'procurement', '234 5678', 'vip']) expect(matches(dinuka, term)).toBe(true);
    expect(matches(dinuka, 'kasun')).toBe(false);
    expect(matches(dinuka, '')).toBe(true);
  });
});
