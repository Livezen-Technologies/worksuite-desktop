# Local AI models (WS-SRS-LAI)

## Which model each computer gets

The catalog on the CDN lists **Qwen3.5** (Apache 2.0) in Q4_K_M GGUF. Settings → Local AI marks one as
**Recommended**, based on this computer's tier (`tierFor` in `shared/local-ai.ts`):

| Tier | This computer | Recommended | Also offered |
|---|---|---|---|
| minimal | under 8 GB memory | Qwen3.5 2B | 0.8B |
| basic | 8–16 GB | **Qwen3.5 4B** (the standard download) | 0.8B, 2B |
| good | 16–32 GB, or a GPU with 6 GB+ | **Qwen3.5 4B** | 0.8B, 2B, 9B |
| strong | 32 GB+, or a GPU with 10 GB+ | Qwen3.5 9B | all |

Qwen3.5 0.8B and 2B are the mobile targets and stay in the list for small machines. The context each model gets
is capped at 8K tokens for now (`engine.ts`); raising it per tier for long documents comes with the benchmarks
(OQ-05).

The starting catalog is `catalog.qwen3.5.json`. To publish it:

```bash
node scripts/local-ai-catalog.mjs keygen ws-2026 ~/secure/ws-2026.pem      # once; pin the printed key in host.ts
node scripts/local-ai-catalog.mjs fill docs/local-ai/catalog.qwen3.5.json ./models body.json   # ./models/<id>.gguf
node scripts/local-ai-catalog.mjs sign body.json ~/secure/ws-2026.pem ws-2026 catalog.json
# upload catalog.json and ./models/*.gguf to https://cdn.worksuite.app/local-ai/…
```

## What runs today, and what comes next

- **Now:** text chat on this computer (AI dock → Ask → **On this computer**), streamed, offline, with no WorkSuite
  data. node-llama-cpp 3.22.1 knows the `qwen35` architecture and Qwen's chat format.
- **Tool calling (next):** the model proposes a call (`mail.create_draft`, `tasks.create`,
  `sales.create_invoice_draft`, `crm.create_followup`, `tender.create_task`, …); a registry in main checks the
  person's permission, the window shows a preview with **Send / Create**, **Edit** and **Cancel**, and the existing
  WorkSuite service carries it out — through the offline queue where the action allows it. The model picks the
  tool and its arguments; totals, tax, currency and anything else authoritative are WorkSuite's (the server is the
  authority), never the model's.
- **Documents (next):** PDF text and tables come from PDF Studio's PDFium engine, DOCX/XLSX text from the Office
  tooling, and only that text goes to the model — not page images.
- **Scanned pages and images (later):** Qwen3.5 reads images, but node-llama-cpp 3.22.1 cannot load the vision
  projector (mmproj) yet. Until it can, scanned pages need OCR first; the catalog will add each model's projector
  file (verified like the model) when the runtime supports it.
- **Routing:** long or critical work (a 150-page tender's compliance gaps, financial analysis) goes to WorkSuite's
  server assistant or a private server model, not the local one.
