import { canonicalJson, sha256Hex } from "./sha256";
import fmAbhaya from "../profiles/fm-abhaya.json";
import dlManel from "../profiles/dl-manel.json";
import kaputa from "../profiles/kaputa.json";
export function profileHash(profile) {
    const copy = { ...profile };
    delete copy.sha256;
    return sha256Hex(canonicalJson(copy));
}
/** Checks a profile's shape and sha256; a tampered or hand-edited profile is refused. */
export function verifyProfile(data) {
    const p = data;
    if (!p || typeof p.id !== "string" || !Array.isArray(p.map) || !Array.isArray(p.fontNames)) {
        throw new Error("not a Sinhala profile");
    }
    for (const pair of p.map) {
        if (!Array.isArray(pair) || pair.length !== 2 || !pair[0] || !pair[1])
            throw new Error(`profile ${p.id}: bad map entry`);
    }
    const seen = new Set();
    for (const [legacy] of p.map) {
        if (seen.has(legacy))
            throw new Error(`profile ${p.id}: "${legacy}" is mapped twice`);
        seen.add(legacy);
    }
    const hash = profileHash(p);
    if (hash !== p.sha256)
        throw new Error(`profile ${p.id} ${p.version}: sha256 ${hash} does not match ${p.sha256}`);
    return p;
}
export const builtinProfiles = [fmAbhaya, dlManel, kaputa].map((p) => verifyProfile(p));
export function getProfile(id, profiles = builtinProfiles) {
    const p = profiles.find((x) => x.id === id);
    if (!p)
        throw new Error(`no Sinhala profile "${id}"`);
    return p;
}
const STYLE_SUFFIX = /(regular|bold|italic|bolditalic|normal)$/;
const squash = (name) => name.toLowerCase().replace(/[\s_-]+/g, "");
/** The profile whose font a run uses: "FMAbhaya", "FM-Abhaya", "DL-Manel-bold" and so on. */
export function profileForFont(fontNames, profiles = builtinProfiles) {
    const names = (Array.isArray(fontNames) ? fontNames : [fontNames]).filter((n) => typeof n === "string" && n !== "");
    for (const name of names) {
        let s = squash(name);
        for (let i = 0; i < 2; i++) {
            for (const p of profiles) {
                if (p.fontNames.some((f) => squash(f) === s))
                    return p;
            }
            s = s.replace(STYLE_SUFFIX, "");
        }
    }
    return null;
}
