# Edge-case implementation matrix

| Edge case | v2 behavior |
|---|---|
| Face model misses small faces | Keep face detector but augment with optional custom detector; no image leaves automatically. |
| Redaction failure | Fail closed: image request is denied unless redaction succeeds and user approves. |
| CORS/tainted cross-origin image | Skip it; never fall back to the original source URL. |
| EXIF/GPS | Re-encode through canvas before transmission; original file bytes are never uploaded. |
| Canvas/video | Not captured automatically. Treat as unknown visual content and require explicit user approval if a future capture path is added. |
| ID/credit card/passport/license plate/QR/signature | Custom local detector + opaque redaction when detected. Human approval still required for visual transmission. |
| Context-dependent proprietary imagery | Cannot be safely classified from pixels alone; default-deny visual gateway handles it. |
| Animated GIF | Current capture is single-frame. Mark limitation; do not claim full animation coverage. |
| CSS background images | v2 adds discovery metadata for `background-image` but does not fetch cross-origin pixel content. |
| Text in screenshots | Image itself remains local until visual request. On approved request, visual detector/OCR hooks can be used; never assume DOM coverage. |
| Hindi/Indic/multilingual text | Tier 0 includes Unicode-aware phone patterns; NER remains optional/English-biased until a multilingual model is validated. |
| Cross-origin iframe | Browser same-origin rules prevent DOM access. Treat as an explicit boundary. |
| Shadow DOM | v2 traverses open shadow roots. Closed roots remain inaccessible by design. |
| Overlapping agent runs | Background has a single-flight guard. |
| Page navigation during run | Requests are tied to tab id and page URL; stale execution is rejected. |
| Stale target element | Commands are revalidated locally before execution. |
| Very large pages | Hard caps on elements and text payload size. |
| Indirect prompt injection | Server prompt treats page text as untrusted data; sensitive type/submit actions require user confirmation locally. |
| Malicious page messaging extension | No `externally_connectable` permission; privileged actions originate from extension UI/background. |
| Medical report / prescription | Covered by document detector plus visual approval. OCR keyword hooks can add evidence. |
| X-ray / CT / MRI / pathology image | `medical_image` detector class is the target. Before that model is validated, default-deny prevents silent transmission. |
