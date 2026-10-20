export declare const ZWJ = "\u200D";
export declare const ZWNJ = "\u200C";
export declare const AL_LAKUNA = "\u0DCA";
export declare const KOMBUVA = "\u0DD9";
export declare const KOMBU_DEKA = "\u0DDB";
export declare function isSinhala(ch: string): boolean;
/** Consonants ක (U+0D9A) to ෆ (U+0DC6). */
export declare function isConsonant(ch: string): boolean;
/** Independent vowels අ (U+0D85) to ඖ (U+0D96). */
export declare function isIndependentVowel(ch: string): boolean;
/** Dependent vowel signs, al-lakuna, anusvara and visarga: marks that need a base. */
export declare function isSign(ch: string): boolean;
/** Dependent vowel signs only (not al-lakuna, anusvara or visarga). */
export declare function isVowelSign(ch: string): boolean;
