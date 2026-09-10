# SIH26171 Privacy-Preserving Vision Agent v2

A browser-first privacy gateway for agentic vision tasks.

## Design principle

**Text/DOM context may leave the browser after local sanitization. Visual pixels do not leave automatically.**
The server first plans from sanitized DOM/metadata. If visual evidence is genuinely required, it asks for a specific image by id. The extension then runs local checks, shows a Privacy Check panel, and only sends the selected image after user approval.

This protects against the fundamental limitation identified in the edge-case review: visual sensitivity is sometimes contextual and cannot be inferred reliably from pixels alone.

## Architecture

1. **Tier 0**: DOM-aware rules and regex. Passwords, tokens, emails, phone numbers, payment cards and URL query strings are sanitized without ML.
2. **Tier 1**: Optional local NER on visible DOM text. It is advisory and never overrides Tier 0.
3. **Tier 2**: Local visual perception. BlazeFace handles faces. An optional custom ONNX detector handles `id_card`, `passport`, `credit_card`, `license_plate`, `qr_code`, `signature`, `medical_document`, and `medical_image`.
4. **Redaction**: Face regions blur; high-risk regions become opaque; OCR/structured text is represented by placeholders.
5. **Visual gateway**: No image is uploaded automatically. The backend may request one image, and the browser shows one contextual approval panel.
6. **Server VLM/LLM**: Receives only sanitized DOM plus sanitized imagery that the user approved; returns structured browser actions.
7. **Action guard**: Sensitive-field type/submit actions require local confirmation. Page-origin/domain policy can block all visual transmission.

## Why medical images are included

Medical content is explicitly represented by the custom detector classes `medical_document` and `medical_image`. This is intentionally not treated as a solved classification problem. A medical X-ray/scan can contain no readable text, so OCR alone is insufficient. Until your custom detector is trained and validated, the default-deny visual gateway still protects these images because the browser cannot transmit them silently.

## Browser targets

Chrome/Edge are the primary demo targets because WebGPU is currently strongest there. Firefox is supported through the extension API and WASM fallback. ONNX Runtime Web supports WASM broadly and WebGPU on Chromium on Windows; Firefox WebGPU availability remains more limited. See `docs/BUILD_WINDOWS.md` for the exact setup.

## Local OCR Privacy Layer

The extension uses the official PaddleOCR.js browser SDK for local OCR.

OCR is executed on-device and is used to identify sensitive text embedded
inside images and screenshots, including:

- email addresses
- phone numbers
- Aadhaar-like 12-digit identifiers
- PAN-like identifiers
- credit-card-like numbers
- OTPs
- passwords
- API keys and access tokens

OCR results never leave the browser as raw text.

Only the resulting locally redacted image may be transmitted after the
visual privacy gateway and user approval permit the requested visual
context.

### Local OCR models

The production extension packages the OCR model archives locally:

    extension/models/ocr/det.tar
    extension/models/ocr/rec.tar

No OCR model is fetched remotely at runtime.

The detection model is based on PP-OCRv5 Mobile Detection and the current
prototype uses the English PP-OCRv5 Mobile Recognition model.

The OCR layer complements, rather than replaces, the custom privacy object
detector. Object detection handles visual classes such as ID cards and
medical images, while OCR handles sensitive text embedded inside arbitrary
screenshots.
