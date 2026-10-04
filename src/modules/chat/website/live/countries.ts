/**
 * The country dataset, for the live dashboard's map and country rows (worksuite-desktop C-00).
 *
 * PORTED FROM THE WEB APP (worksuite web/src/lib/countries.ts), lookup and flags only: the visitor's country is
 * stored as ICU's display name, and the map is keyed by ISO code, so the same forgiving `findCountry` has to bridge
 * the two here as it does there. The web's notes follow.
 *
 * WHY A DELIMITED STRING RATHER THAN 249 OBJECT LITERALS. Written out as
 * objects this is about 20 KB of source with `code:` and `name:` repeated 249
 * times, and every one of those keys is a place a typo hides. As a table it is
 * one line per country, reviewable by eye in a diff, and the parse is four
 * lines that run once at module load. The shape is the same either way — see
 * `Country` below.
 *
 * FIELDS, in order: name | alpha-2 | alpha-3 | dialling code.
 *
 * ISO 3166-1 is the authority for the first three. The dialling code is ITU
 * E.164 and is deliberately allowed to repeat — +1 covers the United States,
 * Canada and eighteen Caribbean territories, and +7 covers Russia and
 * Kazakhstan — so nothing here may be keyed on it.
 */

export interface Country {
  /** Common English name, as ISO 3166-1 lists it. */
  name: string;
  /** ISO 3166-1 alpha-2. The canonical key: unique, short, stable. */
  code: string;
  /** ISO 3166-1 alpha-3. */
  alpha3: string;
  /** ITU E.164 dialling code, with its plus. Not unique — see above. */
  dial: string;
}

const TABLE = `
Afghanistan|AF|AFG|+93
Åland Islands|AX|ALA|+358
Albania|AL|ALB|+355
Algeria|DZ|DZA|+213
American Samoa|AS|ASM|+1
Andorra|AD|AND|+376
Angola|AO|AGO|+244
Anguilla|AI|AIA|+1
Antigua and Barbuda|AG|ATG|+1
Argentina|AR|ARG|+54
Armenia|AM|ARM|+374
Aruba|AW|ABW|+297
Australia|AU|AUS|+61
Austria|AT|AUT|+43
Azerbaijan|AZ|AZE|+994
Bahamas|BS|BHS|+1
Bahrain|BH|BHR|+973
Bangladesh|BD|BGD|+880
Barbados|BB|BRB|+1
Belarus|BY|BLR|+375
Belgium|BE|BEL|+32
Belize|BZ|BLZ|+501
Benin|BJ|BEN|+229
Bermuda|BM|BMU|+1
Bhutan|BT|BTN|+975
Bolivia|BO|BOL|+591
Bosnia and Herzegovina|BA|BIH|+387
Botswana|BW|BWA|+267
Brazil|BR|BRA|+55
British Indian Ocean Territory|IO|IOT|+246
British Virgin Islands|VG|VGB|+1
Brunei|BN|BRN|+673
Bulgaria|BG|BGR|+359
Burkina Faso|BF|BFA|+226
Burundi|BI|BDI|+257
Cambodia|KH|KHM|+855
Cameroon|CM|CMR|+237
Canada|CA|CAN|+1
Cape Verde|CV|CPV|+238
Caribbean Netherlands|BQ|BES|+599
Cayman Islands|KY|CYM|+1
Central African Republic|CF|CAF|+236
Chad|TD|TCD|+235
Chile|CL|CHL|+56
China|CN|CHN|+86
Christmas Island|CX|CXR|+61
Cocos (Keeling) Islands|CC|CCK|+61
Colombia|CO|COL|+57
Comoros|KM|COM|+269
Congo (Brazzaville)|CG|COG|+242
Congo (Kinshasa)|CD|COD|+243
Cook Islands|CK|COK|+682
Costa Rica|CR|CRI|+506
Côte d'Ivoire|CI|CIV|+225
Croatia|HR|HRV|+385
Cuba|CU|CUB|+53
Curaçao|CW|CUW|+599
Cyprus|CY|CYP|+357
Czechia|CZ|CZE|+420
Denmark|DK|DNK|+45
Djibouti|DJ|DJI|+253
Dominica|DM|DMA|+1
Dominican Republic|DO|DOM|+1
Ecuador|EC|ECU|+593
Egypt|EG|EGY|+20
El Salvador|SV|SLV|+503
Equatorial Guinea|GQ|GNQ|+240
Eritrea|ER|ERI|+291
Estonia|EE|EST|+372
Eswatini|SZ|SWZ|+268
Ethiopia|ET|ETH|+251
Falkland Islands|FK|FLK|+500
Faroe Islands|FO|FRO|+298
Fiji|FJ|FJI|+679
Finland|FI|FIN|+358
France|FR|FRA|+33
French Guiana|GF|GUF|+594
French Polynesia|PF|PYF|+689
Gabon|GA|GAB|+241
Gambia|GM|GMB|+220
Georgia|GE|GEO|+995
Germany|DE|DEU|+49
Ghana|GH|GHA|+233
Gibraltar|GI|GIB|+350
Greece|GR|GRC|+30
Greenland|GL|GRL|+299
Grenada|GD|GRD|+1
Guadeloupe|GP|GLP|+590
Guam|GU|GUM|+1
Guatemala|GT|GTM|+502
Guernsey|GG|GGY|+44
Guinea|GN|GIN|+224
Guinea-Bissau|GW|GNB|+245
Guyana|GY|GUY|+592
Haiti|HT|HTI|+509
Honduras|HN|HND|+504
Hong Kong|HK|HKG|+852
Hungary|HU|HUN|+36
Iceland|IS|ISL|+354
India|IN|IND|+91
Indonesia|ID|IDN|+62
Iran|IR|IRN|+98
Iraq|IQ|IRQ|+964
Ireland|IE|IRL|+353
Isle of Man|IM|IMN|+44
Israel|IL|ISR|+972
Italy|IT|ITA|+39
Jamaica|JM|JAM|+1
Japan|JP|JPN|+81
Jersey|JE|JEY|+44
Jordan|JO|JOR|+962
Kazakhstan|KZ|KAZ|+7
Kenya|KE|KEN|+254
Kiribati|KI|KIR|+686
Kosovo|XK|XKX|+383
Kuwait|KW|KWT|+965
Kyrgyzstan|KG|KGZ|+996
Laos|LA|LAO|+856
Latvia|LV|LVA|+371
Lebanon|LB|LBN|+961
Lesotho|LS|LSO|+266
Liberia|LR|LBR|+231
Libya|LY|LBY|+218
Liechtenstein|LI|LIE|+423
Lithuania|LT|LTU|+370
Luxembourg|LU|LUX|+352
Macao|MO|MAC|+853
Madagascar|MG|MDG|+261
Malawi|MW|MWI|+265
Malaysia|MY|MYS|+60
Maldives|MV|MDV|+960
Mali|ML|MLI|+223
Malta|MT|MLT|+356
Marshall Islands|MH|MHL|+692
Martinique|MQ|MTQ|+596
Mauritania|MR|MRT|+222
Mauritius|MU|MUS|+230
Mayotte|YT|MYT|+262
Mexico|MX|MEX|+52
Micronesia|FM|FSM|+691
Moldova|MD|MDA|+373
Monaco|MC|MCO|+377
Mongolia|MN|MNG|+976
Montenegro|ME|MNE|+382
Montserrat|MS|MSR|+1
Morocco|MA|MAR|+212
Mozambique|MZ|MOZ|+258
Myanmar|MM|MMR|+95
Namibia|NA|NAM|+264
Nauru|NR|NRU|+674
Nepal|NP|NPL|+977
Netherlands|NL|NLD|+31
New Caledonia|NC|NCL|+687
New Zealand|NZ|NZL|+64
Nicaragua|NI|NIC|+505
Niger|NE|NER|+227
Nigeria|NG|NGA|+234
Niue|NU|NIU|+683
Norfolk Island|NF|NFK|+672
North Korea|KP|PRK|+850
North Macedonia|MK|MKD|+389
Northern Mariana Islands|MP|MNP|+1
Norway|NO|NOR|+47
Oman|OM|OMN|+968
Pakistan|PK|PAK|+92
Palau|PW|PLW|+680
Palestine|PS|PSE|+970
Panama|PA|PAN|+507
Papua New Guinea|PG|PNG|+675
Paraguay|PY|PRY|+595
Peru|PE|PER|+51
Philippines|PH|PHL|+63
Pitcairn Islands|PN|PCN|+64
Poland|PL|POL|+48
Portugal|PT|PRT|+351
Puerto Rico|PR|PRI|+1
Qatar|QA|QAT|+974
Réunion|RE|REU|+262
Romania|RO|ROU|+40
Russia|RU|RUS|+7
Rwanda|RW|RWA|+250
Saint Barthélemy|BL|BLM|+590
Saint Helena|SH|SHN|+290
Saint Kitts and Nevis|KN|KNA|+1
Saint Lucia|LC|LCA|+1
Saint Martin|MF|MAF|+590
Saint Pierre and Miquelon|PM|SPM|+508
Saint Vincent and the Grenadines|VC|VCT|+1
Samoa|WS|WSM|+685
San Marino|SM|SMR|+378
São Tomé and Príncipe|ST|STP|+239
Saudi Arabia|SA|SAU|+966
Senegal|SN|SEN|+221
Serbia|RS|SRB|+381
Seychelles|SC|SYC|+248
Sierra Leone|SL|SLE|+232
Singapore|SG|SGP|+65
Sint Maarten|SX|SXM|+1
Slovakia|SK|SVK|+421
Slovenia|SI|SVN|+386
Solomon Islands|SB|SLB|+677
Somalia|SO|SOM|+252
South Africa|ZA|ZAF|+27
South Korea|KR|KOR|+82
South Sudan|SS|SSD|+211
Spain|ES|ESP|+34
Sri Lanka|LK|LKA|+94
Sudan|SD|SDN|+249
Suriname|SR|SUR|+597
Svalbard and Jan Mayen|SJ|SJM|+47
Sweden|SE|SWE|+46
Switzerland|CH|CHE|+41
Syria|SY|SYR|+963
Taiwan|TW|TWN|+886
Tajikistan|TJ|TJK|+992
Tanzania|TZ|TZA|+255
Thailand|TH|THA|+66
Timor-Leste|TL|TLS|+670
Togo|TG|TGO|+228
Tokelau|TK|TKL|+690
Tonga|TO|TON|+676
Trinidad and Tobago|TT|TTO|+1
Tunisia|TN|TUN|+216
Türkiye|TR|TUR|+90
Turkmenistan|TM|TKM|+993
Turks and Caicos Islands|TC|TCA|+1
Tuvalu|TV|TUV|+688
Uganda|UG|UGA|+256
Ukraine|UA|UKR|+380
United Arab Emirates|AE|ARE|+971
United Kingdom|GB|GBR|+44
United States|US|USA|+1
Uruguay|UY|URY|+598
Uzbekistan|UZ|UZB|+998
Vanuatu|VU|VUT|+678
Vatican City|VA|VAT|+39
Venezuela|VE|VEN|+58
Vietnam|VN|VNM|+84
Wallis and Futuna|WF|WLF|+681
Western Sahara|EH|ESH|+212
Yemen|YE|YEM|+967
Zambia|ZM|ZMB|+260
Zimbabwe|ZW|ZWE|+263
`;

/** Every country, in the order the table lists them — alphabetical by name. */
export const COUNTRIES: Country[] = TABLE.trim().split('\n').map((line) => {
  const [name = '', code = '', alpha3 = '', dial = ''] = line.split('|');

  return { name, code, alpha3, dial };
});

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

/*
 * Built once at module load rather than on every keystroke. 249 entries is not
 * large, but the search runs on every character typed in every country field on
 * the screen, and lower-casing 249 names four times over per keystroke is work
 * nobody needs to do twice.
 */
const BY_CODE = new Map<string, Country>();
const BY_NAME = new Map<string, Country>();

for (const c of COUNTRIES) {
  BY_CODE.set(c.code.toLowerCase(), c);
  BY_CODE.set(c.alpha3.toLowerCase(), c);
  BY_NAME.set(c.name.toLowerCase(), c);
}

/*
 * Names this application has seen in the wild, or that people reasonably type,
 * mapped onto the ISO name. Not an attempt at every alias in every language —
 * just enough that a record typed before the dropdown existed still resolves,
 * which is the whole reason `find()` is forgiving.
 */
const ALIASES: Record<string, string> = {
  'usa': 'US', 'u.s.a.': 'US', 'u.s.': 'US', 'united states of america': 'US', 'america': 'US',
  'uk': 'GB', 'u.k.': 'GB', 'great britain': 'GB', 'britain': 'GB', 'england': 'GB',
  'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB',
  'uae': 'AE', 'u.a.e.': 'AE',
  'south korea': 'KR', 'korea': 'KR', 'republic of korea': 'KR',
  'north korea': 'KP',
  'russia federation': 'RU', 'russian federation': 'RU',
  'ivory coast': 'CI',
  'holland': 'NL', 'the netherlands': 'NL',
  'czech republic': 'CZ',
  'burma': 'MM',
  'swaziland': 'SZ',
  'macedonia': 'MK',
  'turkey': 'TR',
  'cape verde islands': 'CV',
  'east timor': 'TL',
  'vatican': 'VA', 'holy see': 'VA',
  'palestinian territories': 'PS',
  'hong kong sar': 'HK', 'macau': 'MO',
  'ceylon': 'LK',

  /*
   * ICU's own names, which `loosen()` below cannot bridge because they are
   * different names rather than different spellings. These are not
   * hypothetical: PHP's `Locale::getDisplayRegion()` is what writes the country
   * on every website visitor, so these three strings are in the live database.
   */
  'hong kong sar china': 'HK',
  'macao sar china': 'MO',
  'myanmar burma': 'MM',
};

/**
 * Fold a name to the form two spellings of the same country share.
 *
 * WHY THIS EXISTS, WITH THE RECEIPT. The country stored against a website
 * visitor is written by PHP's `Locale::getDisplayRegion()`, and **20 of the 243
 * names ICU produces did not resolve** against the table above — every
 * `&`-for-"and" (Antigua & Barbuda), every `St.`-for-"Saint" (St. Lucia), a
 * curly apostrophe in Côte d’Ivoire, and a dash where this table has brackets
 * in Congo - Brazzaville. Each one was a country silently missing from the
 * visitor map with nothing on screen to say so.
 *
 * A NORMALISER RATHER THAN TWENTY ALIASES, because the twenty are not twenty
 * facts — they are four mechanical differences, and a table of twenty goes
 * stale the next time ICU adjusts a name. This folds the mechanics and leaves
 * genuine naming differences to `ALIASES`, where they are visible as choices.
 *
 * It is only ever consulted *after* an exact name and an exact code have both
 * missed, so it can never override a real match. `scripts/check-countries.mjs`
 * asserts the property that makes it safe: no two countries fold to the same
 * key.
 */
export function loosen(value: string): string {
  return value
    .toLowerCase()
    // é → e, ô → o, ç → c. NFD splits the accent off; the range is the
    // combining-marks block.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Everything that is not a letter or a digit is a separator: '&', '-',
    // brackets, full stops, and both kinds of apostrophe.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    // "St." and "Saint" are the same word; "and", "the" and "of" carry no
    // information here and the two vocabularies disagree about them
    // ("Saint Vincent and the Grenadines" vs "St. Vincent & Grenadines").
    .map((w) => (w === 'st' ? 'saint' : w))
    .filter((w) => w !== '' && w !== 'and' && w !== 'the' && w !== 'of')
    .join(' ');
}

/*
 * Canonical names first, so a country always wins its own folded key; aliases
 * only fill keys nothing else claimed.
 */
const BY_LOOSE = new Map<string, Country>();

for (const c of COUNTRIES) {
  const k = loosen(c.name);
  if (!BY_LOOSE.has(k)) BY_LOOSE.set(k, c);
}

for (const [alias, code] of Object.entries(ALIASES)) {
  const k = loosen(alias);
  const c = BY_CODE.get(code.toLowerCase());
  if (c && !BY_LOOSE.has(k)) BY_LOOSE.set(k, c);
}

/**
 * Resolve whatever is stored into a country, or null.
 *
 * Deliberately forgiving, and that is the point rather than sloppiness: every
 * country column in this database is free text typed before any dropdown
 * existed. "Sri Lanka", "sri lanka", "LK", "LKA" and "Ceylon" all have to land
 * on the same row, or switching to a picker would silently blank the value on
 * the first save of every record that already had one.
 *
 * Four steps, narrowest first, so a loose match can never beat an exact one.
 * The last is what lets ICU's "St. Kitts & Nevis" find "Saint Kitts and Nevis".
 */
export function findCountry(value: string | null | undefined): Country | null {
  const v = (value ?? '').trim().toLowerCase();

  if (v === '') return null;

  return BY_NAME.get(v)
    ?? BY_CODE.get(v)
    ?? (ALIASES[v] ? BY_CODE.get(ALIASES[v].toLowerCase()) ?? null : null)
    ?? BY_LOOSE.get(loosen(v))
    ?? null;
}

/**
 * The flag, as the two regional-indicator codepoints for the country code.
 *
 * Not an image: it renders from the system font, costs nothing to load, and
 * cannot 404. Windows draws letters rather than flags for these — which is why
 * the name is always shown alongside and the flag never stands alone as the
 * only way to tell one country from another.
 */
export function flagOf(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';

  return String.fromCodePoint(
    ...code.toUpperCase().split('').map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}
