# Windows build guide

## 1. Install

- Node.js 20 LTS or newer
- Python 3.11 or newer
- Git
- Chrome or Edge for primary testing

Check:

```powershell
node --version
npm --version
py --version
```

## 2. Backend

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.example .env
```

Put an API key in `.env`. For a cloud VLM demo, use an Gemini-compatible endpoint. The backend is deliberately provider-neutral at the API boundary.

Start:

```powershell
python -m uvicorn main:app --reload --port 8000
```

Health check: `http://localhost:8000/health`

## 3. Extension dependencies

```powershell
cd ..\extension
npm install
npm run build
```

The current code uses the official Hugging Face Transformers.js package, not the old `@xenova/transformers` package.

## 4. Local NER model (optional)

The extension works without NER. For better text PII coverage, download a compatible ONNX Transformers.js NER model locally. A practical starting point is `Xenova/bert-base-NER` with quantized ONNX weights.

Use:

```powershell
cd extension
pip install -U "huggingface_hub[cli]"
hf download Xenova/bert-base-NER --local-dir .\models\ner
```

Do not enable remote model fetching in production. `models/ner/` should contain the tokenizer/config files and ONNX weights.

## 5. Face model

The project keeps BlazeFace as the baseline because it already works in your prototype. Replace it with a full-range MediaPipe face detector later if the final hardware/browser benchmark shows better recall. Do not auto-upload an image when the face model fails; the code is fail-closed.

Place the existing TensorFlow.js BlazeFace `model.json` and all referenced `.bin` files in:

```text
extension/models/blazeface/
```

## 6. Custom visual privacy detector

Train a small detector locally or in Colab using the training recipe in `training/README.md`. The target labels are:

- face
- id_card
- passport
- credit_card
- license_plate
- qr_code
- signature
- medical_document
- medical_image

Export to ONNX and copy the model to:

```text
extension/models/privacy-detector/model.onnx
```

Also create:

```text
extension/models/privacy-detector/classes.json
```

Example:

```json
[
  "face",
  "id_card",
  "passport",
  "credit_card",
  "license_plate",
  "qr_code",
  "signature",
  "medical_document",
  "medical_image"
]
```

The detector is advisory: it increases the quality of the warning and the redaction mask. It never changes the default-deny image policy.

## 7. Load unpacked extension

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `extension/dist/`.

For Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `extension/dist/manifest.json`.

## 8. Golden test page

From a local static server or VS Code Live Server, open `extension/test-page/index.html`.

Test:

1. password masking
2. email and phone masking
3. image inventory with no automatic image upload
4. Privacy Check after a visual-context request
5. face/document warning
6. domain block policy
7. action confirmation for a sensitive input

## 9. Inspect privacy

The strongest demo is Chrome DevTools → Network:

- first request: sanitized DOM + image metadata only
- optional second request: one user-approved sanitized image
- never an unredacted original

Do not rely on the visual appearance of a blur alone. Inspect request bodies.
