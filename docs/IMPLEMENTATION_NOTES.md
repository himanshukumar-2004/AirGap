# Implementation notes

## What changed from the supplied prototype

- Replaced `@xenova/transformers` usage with the current official `@huggingface/transformers` package.
- Disabled remote model loading in the extension. Local models are the default.
- Stopped sending image `src` values in the first request. The server sees only image metadata.
- Added an explicit visual-context request/approval flow.
- Added fail-closed handling for CORS/canvas failures and missing visual detectors.
- Added open Shadow DOM traversal and CSS background-image metadata discovery.
- Added an advisory custom ONNX detector for sensitive visual classes.
- Added explicit classes for `medical_document` and `medical_image`.
- Added local action guards for sensitive typing and final-submit clicks.
- Added single-flight agent execution to avoid overlapping runs.
- Added stronger URL sanitization and payload limits.
- Added a golden test page with prompt-injection text.

## One important limitation

The prototype does not claim perfect detection. That would be misleading. Privacy is enforced at the protocol boundary: images are denied by default, detector results improve redaction/warnings, and the user authorizes each image transmission request.

The custom detector is the component to optimize for SIH's visual PII precision/recall score. Build a fixed evaluation set and report per-class recall/precision plus latency on the actual judging laptop.
