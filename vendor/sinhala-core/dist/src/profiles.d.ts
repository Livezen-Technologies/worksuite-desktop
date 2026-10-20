/**
 * A legacy font's code-point map. Profiles are data: versioned, hashed (sha256 over the canonical JSON
 * of everything but the sha256 field) and never edited by hand-copying between hosts.
 */
export interface Profile {
    id: string;
    name: string;
    version: string;
    /** "provisional": only the keyboard-layout base is mapped; the font's extra glyphs are reported unmapped. */
    status: "verified" | "provisional";
    /** Font family names (as documents name them) written in this encoding. */
    fontNames: string[];
    notes: string;
    /** Legacy characters that mean themselves (digits, spaces): copied, never reported. */
    passthrough: string;
    /** [legacy, unicode] pairs; legacy keys are matched longest first. */
    map: [string, string][];
    /** Unicode vowel signs the legacy encoding writes before the consonant (kombuva). */
    prebase: string[];
    /** [sequence, composed] pairs applied after reordering (e.g. අ + ා = ආ), undone before encoding. */
    compose: [string, string][];
    sha256: string;
}
export declare function profileHash(profile: Omit<Profile, "sha256"> & {
    sha256?: string;
}): string;
/** Checks a profile's shape and sha256; a tampered or hand-edited profile is refused. */
export declare function verifyProfile(data: unknown): Profile;
export declare const builtinProfiles: Profile[];
export declare function getProfile(id: string, profiles?: Profile[]): Profile;
/** The profile whose font a run uses: "FMAbhaya", "FM-Abhaya", "DL-Manel-bold" and so on. */
export declare function profileForFont(fontNames: string | string[] | undefined | null, profiles?: Profile[]): Profile | null;
