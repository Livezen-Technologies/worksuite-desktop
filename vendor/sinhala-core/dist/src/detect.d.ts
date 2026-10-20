import { Profile } from "./profiles";
export type SegmentKind = "unicode" | "legacy" | "latin";
export interface Segment {
    start: number;
    end: number;
    kind: SegmentKind;
}
export interface Detection {
    /** "mixed": Unicode Sinhala together with legacy text. */
    kind: "unicode" | "legacy" | "mixed" | "latin" | "empty";
    segments: Segment[];
    /** The guessed legacy profile (by font name first), or null when there is no legacy text. */
    profile: string | null;
    /** 0..1: 1 when the run's font names the profile. */
    confidence: number;
}
/**
 * Classifies a run of text: Unicode Sinhala, legacy-font text, or plain Latin. A run in a legacy font
 * (fontNames) is legacy wherever it is not Unicode; otherwise the words are scored.
 */
export declare function detect(text: string, options?: {
    fontNames?: string[] | string | null;
    profiles?: Profile[];
}): Detection;
