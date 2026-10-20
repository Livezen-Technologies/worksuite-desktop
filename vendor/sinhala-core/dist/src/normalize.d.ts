export type IssueCode = "not-nfc" | "sign-without-base" | "kombuva-before-consonant" | "double-vowel-sign" | "zwj-order" | "stray-zwj" | "stray-zwnj";
export interface Issue {
    offset: number;
    length: number;
    code: IssueCode;
    /** fixed by normalize() */
    fixable: boolean;
}
/**
 * Unicode Sinhala as it should be stored: NFC; ේ + ා written as ෝ; yansaya and rakaransaya as
 * al-lakuna + ZWJ + ය/ර (not ZWJ + al-lakuna, which is the touching-letter order); no repeated joiners;
 * no joiner that is not next to an al-lakuna. Everything else is left as it is.
 */
export declare function normalize(input: string): {
    text: string;
    changed: boolean;
};
/** Problems in Unicode Sinhala text: broken conjuncts, stray joiners, vowel signs in legacy order. */
export declare function validate(text: string): Issue[];
