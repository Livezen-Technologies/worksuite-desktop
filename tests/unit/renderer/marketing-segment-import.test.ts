import { describe, expect, it } from 'vitest';
import {
  assignField,
  checkFile,
  checkRows,
  dataRows,
  decodeCsv,
  fileSize,
  hasConsentColumn,
  IMPORT_FIELDS,
  IMPORT_LIMITS,
  initialMapping,
  mapsContactKey,
  parseCsv,
  splitTags,
  suggestMapping,
} from '../../../src/modules/marketing/lib/csv';
import { emailKey, matchKey, nameOrgKey, phoneKey } from '../../../src/modules/marketing/lib/dedupe';
import {
  BASELINE_FIELDS,
  canAddRule,
  cleanRule,
  emptyRule,
  FIELDS,
  GROUPS,
  MAX_RULES,
  OPERATORS,
  plannedGroup,
  ruleProblem,
  ruleSentence,
  rulesSummary,
  validRule,
  withField,
  withOperator,
} from '../../../src/modules/marketing/lib/segment';

/**
 * Marketing · segments and CSV import (WS-MKT-SRS-001 MKT-SEG-01, MKT-IMP-01..03, MKT-AUD-02): the rule model the
 * builder edits, the limits and parsing done before a file is sent, the suggested column mapping, and the dedupe keys.
 */

const BOM = String.fromCharCode(0xfeff);

describe('CSV parsing (RFC 4180)', () => {
  it('reads plain rows and ignores the trailing empty line', () => {
    expect(parseCsv('email,name\nnimal@ceylonagri.lk,Nimal Perera\n')).toEqual([
      ['email', 'name'],
      ['nimal@ceylonagri.lk', 'Nimal Perera'],
    ]);
    expect(parseCsv('a,b\n1,')).toEqual([
      ['a', 'b'],
      ['1', ''],
    ]);
    expect(parseCsv('')).toEqual([]);
  });

  it('keeps commas, line breaks and doubled quotes inside quoted fields', () => {
    const rows = parseCsv('name,notes,quote\n"Perera, Nimal","first line\nsecond line","say ""hi"""\n');
    expect(rows).toEqual([
      ['name', 'notes', 'quote'],
      ['Perera, Nimal', 'first line\nsecond line', 'say "hi"'],
    ]);
    expect(parseCsv('a,"",c')).toEqual([['a', '', 'c']]);
  });

  it('reads CRLF, LF and a lone CR alike', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseCsv('a\r1\n2')).toEqual([['a'], ['1'], ['2']]);
    expect(parseCsv('"x\r\ny",z\r\n')).toEqual([['x\r\ny', 'z']]);
  });

  it('drops a UTF-8 byte-order mark from the first header', () => {
    const rows = parseCsv(`${BOM}email,name\r\nx@y.lk,Z\r\n`);
    expect(rows[0]).toEqual(['email', 'name']);
    expect(rows[0]![0]!.charCodeAt(0)).toBe('e'.charCodeAt(0));
  });

  it('keeps Sinhala and Tamil text intact (NFR-12)', () => {
    const text = 'නම,email,organisation\nනිමල් පෙරේරා,nimal@ceylonagri.lk,ලංකා පැක්\n"சுரேஷ் குமார், Jr",suresh@lankapack.lk,லங்கா பேக்\n';
    const rows = parseCsv(text);
    expect(rows[0]![0]).toBe('නම');
    expect(rows[1]).toEqual(['නිමල් පෙරේරා', 'nimal@ceylonagri.lk', 'ලංකා පැක්']);
    expect(rows[2]![0]).toBe('சுரேஷ் குமார், Jr');
    expect(rows[2]![2]).toBe('லங்கா பேக்');
  });

  it('counts only the data rows that hold something', () => {
    const rows = parseCsv('email,name\na@b.lk,A\n\n , \nc@d.lk,C\n\n\n');
    expect(dataRows(rows)).toEqual([
      ['a@b.lk', 'A'],
      ['c@d.lk', 'C'],
    ]);
    expect(dataRows(parseCsv('email,name\n'))).toEqual([]);
  });

  it('takes UTF-8 text and refuses UTF-16 or legacy encodings with a reason', () => {
    const ok = decodeCsv(new TextEncoder().encode('නම,email\nනිමල්,n@x.lk\n'));
    expect(ok.error).toBeNull();
    expect(ok.text).toContain('නිමල්');
    expect(decodeCsv(new Uint8Array([0xff, 0xfe, 0x61, 0x00])).error).toMatch(/UTF-16/);
    // "Niél" in Windows-1252: é is 0xE9, not valid UTF-8.
    expect(decodeCsv(new Uint8Array([0x4e, 0x69, 0xe9, 0x6c])).error).toMatch(/UTF-8/);
  });
});

describe('import limits (10 MB / 10,000 rows, checked before anything is sent)', () => {
  it('refuses what is not a .csv, over 10 MB, or empty', () => {
    expect(IMPORT_LIMITS).toEqual({ bytes: 10 * 1024 * 1024, rows: 10_000 });
    expect(checkFile({ name: 'vendors-oct.csv', size: 212 * 1024 })).toBeNull();
    expect(checkFile({ name: 'VENDORS.CSV', size: 10 * 1024 * 1024 })).toBeNull();
    expect(checkFile({ name: 'vendors.xlsx', size: 1000 })).toMatch(/isn’t a CSV file/);
    expect(checkFile({ name: 'big.csv', size: 11 * 1024 * 1024 })).toMatch(/11\.0 MB; the limit is 10 MB/);
    expect(checkFile({ name: 'just-over.csv', size: 10 * 1024 * 1024 + 1 })).toMatch(/the limit is 10 MB/);
    expect(checkFile({ name: 'empty.csv', size: 0 })).toMatch(/is empty/);
  });

  it('refuses more than 10,000 rows, or none', () => {
    expect(checkRows(1)).toBeNull();
    expect(checkRows(10_000)).toBeNull();
    expect(checkRows(10_001)).toMatch(/10,001 rows; the limit is 10,000/);
    expect(checkRows(0)).toMatch(/no rows/);
  });

  it('says sizes as the header does', () => {
    expect(fileSize(212 * 1024)).toBe('212 KB');
    expect(fileSize(11 * 1024 * 1024)).toBe('11.0 MB');
    expect(fileSize(512)).toBe('512 B');
  });
});

describe('column mapping', () => {
  const noTwice = (m: Record<string, string>) => {
    const used = Object.values(m).filter((f) => f !== 'ignore');
    expect(new Set(used).size).toBe(used.length);
  };

  it('suggests a field from common header names', () => {
    const m = suggestMapping(['First Name', 'Last Name', 'E-mail', 'Mobile', 'Company', 'Designation', 'Consent', 'Tags', 'Notes']);
    expect(m).toEqual({
      'First Name': 'first_name',
      'Last Name': 'last_name',
      'E-mail': 'email',
      Mobile: 'phone',
      Company: 'organisation',
      Designation: 'job_title',
      Consent: 'email_consent',
      Tags: 'tags',
      Notes: 'ignore',
    });
    expect(suggestMapping(['Full name', 'Telephone', 'Organization', 'Title', 'Surname', 'Given name'])).toEqual({
      'Full name': 'name',
      Telephone: 'phone',
      Organization: 'organisation',
      Title: 'job_title',
      Surname: 'last_name',
      'Given name': 'first_name',
    });
    expect(suggestMapping(['contact_number', 'mail', 'organisation', 'position', 'subscribed'])).toEqual({
      contact_number: 'phone',
      mail: 'email',
      organisation: 'organisation',
      position: 'job_title',
      subscribed: 'email_consent',
    });
  });

  it('never gives one field to two headers; the better name wins', () => {
    const m = suggestMapping(['Mail', 'Email', 'Phone', 'Mobile', 'Tel', 'Contact number', 'Company', 'Organisation']);
    expect(m.Email).toBe('email');
    expect(m.Mail).toBe('ignore');
    expect(m.Phone).toBe('phone');
    expect(m.Mobile).toBe('ignore');
    expect(m.Tel).toBe('ignore');
    expect(m['Contact number']).toBe('ignore');
    expect(m.Organisation).toBe('organisation');
    expect(m.Company).toBe('ignore');
    noTwice(m);
  });

  it('guesses from the words in a header, still once per field', () => {
    const m = suggestMapping(['Work Email', 'Mobile Phone', 'Company Name (registered)', 'Phone consent (calls)', 'Email opt-in', 'Home email']);
    expect(m).toEqual({
      'Work Email': 'email',
      'Mobile Phone': 'phone',
      'Company Name (registered)': 'organisation',
      'Phone consent (calls)': 'phone_consent',
      'Email opt-in': 'email_consent',
      'Home email': 'ignore',
    });
    noTwice(m);
    // "Last contacted" is not a last name, and "Hotel" is not a telephone.
    expect(suggestMapping(['Last contacted', 'Hotel'])).toEqual({ 'Last contacted': 'ignore', Hotel: 'ignore' });
  });

  it('reads Sinhala and Tamil headers', () => {
    expect(suggestMapping(['නම', 'ඊමේල්', 'දුරකථනය', 'ආයතනය'])).toEqual({ නම: 'name', ඊමේල්: 'email', දුරකථනය: 'phone', ආයතනය: 'organisation' });
    expect(suggestMapping(['பெயர்', 'மின்னஞ்சல்', 'தொலைபேசி'])).toEqual({ பெயர்: 'name', மின்னஞ்சல்: 'email', தொலைபேசி: 'phone' });
  });

  it('moves a field when it is given to another header', () => {
    const m = assignField({ Mail: 'email', Email: 'ignore', Phone: 'phone' }, 'Email', 'email');
    expect(m).toEqual({ Mail: 'ignore', Email: 'email', Phone: 'phone' });
    expect(assignField(m, 'Phone', 'ignore')).toEqual({ Mail: 'ignore', Email: 'email', Phone: 'ignore' });
    noTwice(m);
  });

  it('starts from the mapping the server remembers for the header set', () => {
    expect(initialMapping(['Mail', 'Phone No', 'Org', 'Notes'], { Mail: 'email', 'Phone No': 'phone', Notes: 'ignore' })).toEqual({ Mail: 'email', 'Phone No': 'phone', Org: 'organisation', Notes: 'ignore' });
    expect(initialMapping(['Email', 'Mobile'], {})).toEqual(suggestMapping(['Email', 'Mobile']));
    expect(initialMapping(['A', 'B'], { A: 'email', B: 'email' })).toEqual({ A: 'email', B: 'ignore' });
  });

  it('knows a consent column and a contact key when it sees one', () => {
    expect(hasConsentColumn({ Email: 'email', Consent: 'email_consent' })).toBe(true);
    expect(hasConsentColumn({ Email: 'email', Phone: 'phone' })).toBe(false);
    expect(mapsContactKey({ Name: 'name', Mobile: 'phone' })).toBe(true);
    expect(mapsContactKey({ Name: 'name', Company: 'organisation' })).toBe(false);
    expect(IMPORT_FIELDS.map((f) => f.value)).toEqual(['first_name', 'last_name', 'name', 'email', 'phone', 'organisation', 'job_title', 'tags', 'source', 'time_zone', 'email_consent', 'phone_consent', 'ignore']);
  });

  it('splits tags on commas, once each', () => {
    expect(splitTags(' vendor, Oct  2026 ,vendor,, VENDOR ')).toEqual(['vendor', 'Oct 2026']);
    expect(splitTags('')).toEqual([]);
  });
});

describe('dedupe keys (MKT-AUD-02)', () => {
  it('keys a phone on its last nine digits', () => {
    expect(phoneKey('+94 77 123 4521')).toBe('771234521');
    expect(phoneKey('0771234521')).toBe('771234521');
    expect(phoneKey('+94 77 123 4521')).toBe(phoneKey('0771234521'));
    expect(phoneKey('077-123-452')).toBe('077123452');
    expect(phoneKey('071 234 56')).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });

  it('keys an email trimmed and lower-cased, and refuses what is not an address', () => {
    expect(emailKey(' SHALINI@lankapack.lk ')).toBe('shalini@lankapack.lk');
    expect(emailKey('shalini@lankapack.lk')).toBe(emailKey('SHALINI@lankapack.lk'));
    expect(emailKey('ravi@@mail')).toBeNull();
    expect(emailKey('ravi@mail')).toBeNull();
    expect(emailKey('')).toBeNull();
  });

  it('keys a name at an organisation, whitespace and case folded', () => {
    expect(nameOrgKey('  Suresh   Bandara ', 'Bandara  TRADERS')).toBe('suresh bandara@bandara traders');
    expect(nameOrgKey('Suresh Bandara', null)).toBeNull();
    expect(nameOrgKey('නිමල් පෙරේරා', 'ලංකා  පැක්')).toBe('නිමල් පෙරේරා@ලංකා පැක්');
  });

  it('matches on email, then phone, then name at organisation', () => {
    expect(matchKey({ email: 'nimal@ceylonagri.lk', phone: '0771234521' }, { email: 'NIMAL@ceylonagri.lk', phone: '+94 77 123 4521' })).toBe('email_key');
    expect(matchKey({ email: 'kasun@a.lk', phone: '0718890123' }, { email: 'kasun@b.lk', phone: '+94 71 889 0123' })).toBe('phone_key');
    expect(matchKey({ phone: '0771234521' }, { phone: '+94 77 123 4521' })).toBe('phone_key');
    expect(matchKey({ name: 'Suresh Bandara', organisation: 'Bandara Traders' }, { name: 'suresh  bandara', organisation: 'BANDARA TRADERS' })).toBe('name_org');
    expect(matchKey({ name: 'Suresh Bandara' }, { name: 'Suresh Bandara' })).toBeNull();
    expect(matchKey({ email: 'ravi@@mail' }, { email: 'ravi@@mail' })).toBeNull();
  });
});

describe('segment rules (MKT-SEG-01)', () => {
  it('has 19 baseline fields in 9 groups, and the three planned ones', () => {
    expect(BASELINE_FIELDS).toBe(19);
    expect(FIELDS.filter((f) => !f.planned).map((f) => f.key)).toEqual([
      'email',
      'name',
      'phone',
      'tag',
      'list',
      'source',
      'owner',
      'email_consent',
      'phone_consent',
      'topic',
      'organisation',
      'industry',
      'country',
      'time_zone',
      'created_at',
      'last_activity_at',
      'last_open_at',
      'last_click_at',
      'campaign_received',
    ]);
    expect(FIELDS.filter((f) => f.planned).map((f) => f.key)).toEqual(['call_outcome', 'callback_due', 'crm_lead_status']);
    expect(new Set(FIELDS.map((f) => f.key)).size).toBe(FIELDS.length);
    expect(GROUPS).toHaveLength(9);
    for (const f of FIELDS) expect(GROUPS).toContain(f.group);
    expect(plannedGroup('Call outcome · callback due')).toBe(true);
    expect(plannedGroup('CRM lead status')).toBe(true);
    expect(plannedGroup('Tag · List · Source')).toBe(false);
  });

  it('compares each kind of field in its own words', () => {
    const labels = (t: keyof typeof OPERATORS) => OPERATORS[t].map((o) => o.label);
    expect(labels('text')).toEqual(['is', 'is not', 'contains', 'starts with', 'is empty']);
    expect(labels('enum')).toEqual(['is', 'is not']);
    expect(labels('date')).toEqual(['within last', 'before', 'after', 'is empty']);
    for (const t of ['list', 'tag', 'topic', 'campaign'] as const) expect(labels(t)).toEqual(['includes', 'does not include']);
  });

  it('refuses a 21st rule', () => {
    expect(MAX_RULES).toBe(20);
    expect(canAddRule([])).toBe(true);
    expect(canAddRule(Array.from({ length: 19 }, () => emptyRule('tag')))).toBe(true);
    expect(canAddRule(Array.from({ length: 20 }, () => emptyRule('tag')))).toBe(false);
  });

  it('starts a rule with the field’s first comparison and no value', () => {
    expect(emptyRule('tag')).toEqual({ field: 'tag', op: 'includes', value: '' });
    expect(emptyRule('last_open_at')).toEqual({ field: 'last_open_at', op: 'within_last', value: '' });
    expect(emptyRule('email_consent')).toEqual({ field: 'email_consent', op: 'is', value: '' });
  });

  it('knows a complete rule from one still being written', () => {
    expect(validRule({ field: 'tag', op: 'includes', value: 'vendor' })).toBe(true);
    expect(validRule({ field: 'tag', op: 'includes', value: '  ' })).toBe(false);
    expect(validRule({ field: 'last_open_at', op: 'within_last', value: '90' })).toBe(true);
    expect(validRule({ field: 'last_open_at', op: 'within_last', value: '0' })).toBe(false);
    expect(validRule({ field: 'last_open_at', op: 'within_last', value: '9 0' })).toBe(false);
    expect(validRule({ field: 'created_at', op: 'before', value: '2026-02-28' })).toBe(true);
    expect(validRule({ field: 'created_at', op: 'before', value: '2026-02-30' })).toBe(false);
    expect(validRule({ field: 'email_consent', op: 'is', value: 'subscribed' })).toBe(true);
    expect(validRule({ field: 'email_consent', op: 'is', value: 'maybe' })).toBe(false);
    expect(validRule({ field: 'phone', op: 'is_empty', value: '' })).toBe(true);
    expect(validRule({ field: 'list', op: 'includes', value: '12' })).toBe(true);
    expect(validRule({ field: 'tag', op: 'is', value: 'vendor' })).toBe(false);
    expect(validRule({ field: 'shoe_size', op: 'is', value: '9' })).toBe(false);
    expect(validRule({ field: 'call_outcome', op: 'is', value: 'interested' })).toBe(false);
    expect(ruleProblem({ field: 'crm_lead_status', op: 'is', value: 'won' })).toMatch(/planned/);
  });

  it('reads a rule as a sentence', () => {
    expect(ruleSentence({ field: 'tag', op: 'includes', value: 'vendor' })).toBe('Tag includes vendor');
    expect(ruleSentence({ field: 'email_consent', op: 'is', value: 'subscribed' })).toBe('Email consent is subscribed');
    expect(ruleSentence({ field: 'last_open_at', op: 'within_last', value: '90' })).toBe('Last email opened within last 90 days');
    expect(ruleSentence({ field: 'country', op: 'is', value: 'Sri Lanka' })).toBe('Organisation · country is Sri Lanka');
    expect(ruleSentence({ field: 'tag', op: 'not_includes', value: 'supplier' })).toBe('Tag does not include supplier');
    expect(ruleSentence({ field: 'phone', op: 'is_empty', value: '' })).toBe('Phone is empty');
    expect(ruleSentence({ field: 'created_at', op: 'after', value: '2026-01-01' })).toBe('Created after 1 Jan 2026');
    expect(ruleSentence({ field: 'list', op: 'includes', value: '12' })).toBe('List includes #12');
    expect(ruleSentence({ field: 'list', op: 'includes', value: '12' }, (f, v) => (f.type === 'list' && v === '12' ? 'Vendors 2026' : null))).toBe('List includes Vendors 2026');
    expect(ruleSentence({ field: 'organisation', op: 'is', value: 'ලංකා පැක්' })).toBe('Organisation is ලංකා පැක්');
    expect(rulesSummary([emptyRule('tag'), emptyRule('list')], 'any')).toBe('2 · any');
  });

  it('keeps what still makes sense when the field or comparison changes', () => {
    const recent = { field: 'created_at', op: 'within_last', value: '90' };
    expect(withField(recent, 'last_open_at')).toEqual({ field: 'last_open_at', op: 'within_last', value: '90' });
    expect(withField({ field: 'email', op: 'contains', value: '@lankapack.lk' }, 'name')).toEqual({ field: 'name', op: 'contains', value: '@lankapack.lk' });
    expect(withField({ field: 'tag', op: 'includes', value: 'vendor' }, 'list')).toEqual({ field: 'list', op: 'includes', value: '' });
    expect(withField({ field: 'email_consent', op: 'is', value: 'subscribed' }, 'phone_consent')).toEqual({ field: 'phone_consent', op: 'is', value: '' });
    expect(withOperator(recent, 'before')).toEqual({ field: 'created_at', op: 'before', value: '' });
    expect(withOperator({ field: 'name', op: 'is', value: 'Nimal' }, 'is_not')).toEqual({ field: 'name', op: 'is_not', value: 'Nimal' });
    expect(withOperator({ field: 'name', op: 'contains', value: 'Nimal' }, 'is_empty')).toEqual({ field: 'name', op: 'is_empty', value: '' });
    expect(cleanRule({ field: 'tag', op: 'includes', value: '  vendor ' })).toEqual({ field: 'tag', op: 'includes', value: 'vendor' });
    expect(cleanRule({ field: 'phone', op: 'is_empty', value: 'x' })).toEqual({ field: 'phone', op: 'is_empty', value: '' });
  });
});
