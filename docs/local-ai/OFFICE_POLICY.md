# WorkSuite Office Local AI policy: delivery through WorkSuite Desktop

Local AI spec W10: an administrator sets WorkSuite Office's Local AI policy in the Admin Center; WorkSuite Desktop
delivers it; Office's local `worksuite-ai` service reads it from the operating system's managed-configuration
location and serves it at `GET /v1/policy`.

Before this, the desktop only **read** managed configuration (`enterprise.ts`, `discovery/trusted-config.ts`) and
had no way to hand policy to another app. `electron/services/office-ai-policy.ts` (desktop module `office`) is
that pass-through.

## Flow

1. Every bootstrap (`bootstrapChanged`) calls `OfficeAiPolicySync.sync()`, which reads
   `GET /api/ai/office-policy` (server Ai 1.19.0). The same object is also in `GET /desktop/v1/policies` as
   `office.ai.policy`.
2. The answer must be exactly the `GET /v1/policy` shape:
   `{managed, features{stt,suggestions,correction,translate,tts,assistant}, cloudAllowed, approvedModels[],
   maxMemMB|null, gpuAllowed, orgDictionaryUrl|null, offlineOnly}`. Anything else is refused and the last written
   policy stays. An older server (404) or no network changes nothing.
3. `managed: false` and sign-out remove what the desktop wrote.

## Where it is written

| OS | Location | Form |
|---|---|---|
| macOS | user defaults, domain `lk.worksuite.office` | `AISource`, `AIManaged`, `AIFeatureStt` … `AIFeatureAssistant`, `AICloudAllowed`, `AIGpuAllowed`, `AIOfflineOnly` (bool), `AIApprovedModels` (array), `AIMaxMemMB` (int, 0 = no cap), `AIOrgDictionaryUrl` (string), `AIPolicy` (the JSON) |
| Windows | `HKCU\Software\Policies\WorkSuite\Office\AI` | `Source`, `OrgDictionaryUrl`, `Policy` REG_SZ; `Managed`, `Feature*`, `CloudAllowed`, `GpuAllowed`, `OfflineOnly`, `MaxMemMB` REG_DWORD; `ApprovedModels` REG_MULTI_SZ |
| Linux | `$XDG_CONFIG_HOME/worksuite/office/policy.json` (default `~/.config/…`), mode 0600, written atomically | `{"schema":1,"source":"worksuite-desktop","updatedAt":…,"ai":{…}}` |

## Precedence and MDM

- Every location carries `Source = worksuite-desktop`. A location written by anything else (MDM, Group Policy,
  a hand-placed file) is never overwritten or removed; `sync()` reports `skipped-managed-elsewhere`.
- The service should read machine-wide managed locations first — macOS `/Library/Managed Preferences`
  (`lk.worksuite.office`), Windows `HKLM\Software\Policies\WorkSuite\Office\AI` — and the per-user locations
  above only when those are absent.

## Known limits

- On some Windows builds a standard user cannot write `HKCU\Software\Policies`; the write fails, is logged, and
  the previous policy stays. Deploy the same keys by Group Policy there, or have the service also read
  `HKCU\Software\WorkSuite\Office\AI` (not written today).
- macOS user defaults are not "managed" in the MDM sense: the user could change them. The service treats them as
  delivered policy because only the desktop writes them; tamper-proof enforcement needs an MDM profile.
