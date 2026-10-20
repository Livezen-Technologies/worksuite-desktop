import { Profile } from "./profiles";
export type Direction = "toUnicode" | "toLegacy";
/** A character the profile has no mapping for. It is left in the output as it was, never dropped. */
export interface Unmapped {
    /** Offset (UTF-16 code units) in the input; for toLegacy, in the NFC form of the input. */
    offset: number;
    text: string;
    /** "U+0041" */
    codePoint: string;
}
export interface ConvertResult {
    text: string;
    unmapped: Unmapped[];
    profile: string;
    profileVersion: string;
    direction: Direction;
}
/** Legacy font text to Unicode Sinhala: longest-match lookup, then kombuva moved after its consonant cluster. */
export declare function toUnicode(input: string, profile: Profile): ConvertResult;
/** Unicode Sinhala to a legacy font's encoding: decompose, kombuva before the cluster, reverse lookup. */
export declare function toLegacy(input: string, profile: Profile): ConvertResult;
export declare function convert(text: string, profile: Profile, direction?: Direction): ConvertResult;
