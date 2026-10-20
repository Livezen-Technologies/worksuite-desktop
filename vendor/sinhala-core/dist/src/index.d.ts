export { sha256Hex, canonicalJson } from "./sha256";
export { Profile, builtinProfiles, getProfile, profileForFont, profileHash, verifyProfile } from "./profiles";
export { ConvertResult, Direction, Unmapped, convert, toLegacy, toUnicode } from "./convert";
export { Detection, Segment, SegmentKind, detect } from "./detect";
export { Issue, IssueCode, normalize, validate } from "./normalize";
export { isSinhala, isConsonant, ZWJ, ZWNJ } from "./script";
export declare const VERSION = "1.0.0";
