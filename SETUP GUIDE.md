# AirGap

AirGap is a privacy-preserving browser-agent project designed to keep sensitive information on the user's device while enabling AI-assisted browser interactions.

The project currently contains three main areas:

- `backend/` — Python backend/service code.
- `extension/` — browser extension, including the privacy/redaction pipeline, OCR, NER, DOM processing, vision/WASM components, and the extension UI.
- `training/` — training resources, datasets, labels, and documentation for the custom privacy model.

## Project Structure

```text
AirGap/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── .env.example
│   └── ...
│
├── extension/
│   ├── src/
│   │   ├── background.js
│   │   ├── content.js
│   │   ├── crypto.js
│   │   ├── dom.js
│   │   ├── ocr.js
│   │   ├── popup.js
│   │   ├── privacy-vision.js
│   │   ├── regexRules.js
│   │   └── vision.js
│   ├── models/
│   │   ├── blazeFace/
│   │   ├── ner/
│   │   ├── ocr/
│   │   └── privacy-detector/
│   ├── public/
│   ├── manifest.json
│   ├── popup.html
│   ├── offscreen.html
│   ├── build.mjs
│   └── package.json
│
├── training/
│   ├── dataset/
│   ├── classes.txt
│   └── README.md
│
├── docs/
│   ├── BUILD_WINDOWS.md
│   ├── EDGE_CASE_MATRIX.md
│   └── IMPLEMENTATION_NOTES.md
│
├── README.md
└── .gitignore
```

> The exact generated files inside `extension/dist/` may vary depending on the build.

## Requirements

Before setting up the project, install:

- Git
- Node.js and npm
- Python 3.11+ recommended
- A Chromium-based browser such as Google Chrome or Microsoft Edge
- VS Code (recommended, but not required)

Check your installations:

```powershell
git --version
node --version
npm --version
python --version
```

## 1. Clone the Repository

```powershell
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd AirGap
```

## 2. Backend Setup

Open a terminal in the project root.

### Create and activate the Python virtual environment

Windows PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Windows Command Prompt:

```cmd
cd backend
python -m venv .venv
.venv\Scripts\activate
```

### Install Python dependencies

```powershell
pip install -r requirements.txt
```

### Configure environment variables

Create your local `.env` file from the example:

```powershell
Copy-Item .env.example .env
```

Then open `backend/.env` and add the required local configuration/secrets.

**Never commit `backend/.env` to GitHub.**

The repository should contain `.env.example` with variable names and safe example values, but not real API keys, tokens, passwords, or other secrets.

### Run the backend

```powershell
python main.py
```

If the backend exposes a specific host/port, check `backend/main.py` or the project documentation for the configured endpoint.

## 3. Extension Setup

Open a second terminal.

```powershell
cd extension
npm install
```

### Build the extension

```powershell
npm run build
```

The build should generate/update the `extension/dist/` directory.

If the project uses a different npm script on your machine, check:

```powershell
npm run
```

and use the build script defined in `extension/package.json`.

### Load the extension in Chrome/Edge

1. Build the extension.
2. Open the browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select the project's `extension/dist/` folder.
6. Reload the extension after rebuilding when necessary.

## 4. Model Files

The extension uses several local model assets:

- **BlazeFace** — face detection.
- **NER** — semantic text/entity detection.
- **PaddleOCR** — text detection and recognition in images.
- **Gemma web model** — visual classification fallback.
- **Custom YOLOX detector** — planned/custom privacy-detector model.
- **MediaPipe/WASM assets** — browser-side inference support.

Small model assets that are practical to keep in source control are included in the repository. Large model binaries are excluded and must be downloaded separately as described in the **Required External Models** section.

To inspect local file sizes before committing:

```powershell
Get-ChildItem -Recurse . | Sort-Object Length -Descending | Select-Object -First 30 FullName, Length
```

Do not commit large model binaries, generated build output, or other artifacts that are intentionally excluded by `.gitignore`.

## Required External Models

Some large model files are intentionally excluded from this repository so that the GitHub repository remains lightweight. They must be downloaded separately and placed in the paths described below.

### NER Model

AirGap uses a local Named Entity Recognition (NER) model for semantic detection of entities such as people, organizations, and locations. The extension uses Hugging Face Transformers.js in local-only mode and requests a quantized NER model.

The model is based on `dslim/bert-base-NER`.

#### Download the quantized ONNX model

Download the Transformers.js-compatible quantized model from Hugging Face:

**[Download `model_quantized.onnx` — Xenova/bert-base-NER](https://huggingface.co/Xenova/bert-base-NER/blob/main/onnx/model_quantized.onnx)**

Save the file as:

```text
model_quantized.onnx
```

Place it here:

```text
extension/models/ner/onnx/model_quantized.onnx
```

Your local NER directory should look like:

```text
extension/
└── models/
    └── ner/
        ├── config.json
        ├── tokenizer.json
        ├── tokenizer_config.json
        ├── special_tokens_map.json
        ├── vocab.txt
        └── onnx/
            └── model_quantized.onnx
```

The large ONNX model is intentionally excluded from GitHub. Do not commit it to the repository.

### Privacy-Detector Model

The current visual privacy pipeline also uses the Gemma web model. Download the required `.task` model separately and place it under:

```text
extension/models/privacy-detector/
```

The custom YOLOX privacy-detector model (`model.onnx`) is planned for a future version and is not part of the current model distribution.

### Build after downloading the models

After placing the required model files in the paths above:

```powershell
cd extension
npm install
npm run build
```

The build generates the `extension/dist/` directory used to load the extension in Chrome or Microsoft Edge.

## 5. Training Setup

The `training/` directory contains the project's training-related resources.

Start by reading:

```text
training/README.md
```

before modifying the dataset, labels, or training pipeline.

Do not commit private datasets, credentials, experiment artifacts, or large generated outputs unless they are intentionally part of the project distribution.

## 6. Development Workflow

A typical development workflow is:

```powershell
# Terminal 1 — backend
cd backend
.\.venv\Scripts\Activate.ps1
python main.py
```

```powershell
# Terminal 2 — extension
cd extension
npm install
npm run build
```

Then load/reload `extension/dist/` in the browser.

When changing extension source code, rebuild before testing the packaged extension.

## 7. Important Files

### Backend

- `backend/main.py` — backend entry point.
- `backend/requirements.txt` — Python dependencies.
- `backend/.env.example` — environment-variable template.
- `backend/.env` — local secrets/configuration; **do not commit**.

### Extension

- `extension/manifest.json` — browser extension manifest.
- `extension/src/background.js` — background/service-worker logic.
- `extension/src/content.js` — page/content-script logic.
- `extension/src/dom.js` — DOM-related processing.
- `extension/src/ocr.js` — OCR functionality.
- `extension/src/privacy-vision.js` — privacy/vision processing.
- `extension/src/vision.js` — vision-related functionality.
- `extension/src/crypto.js` — cryptographic/helper logic.
- `extension/build.mjs` — extension build process.

### Documentation

- `docs/BUILD_WINDOWS.md` — Windows build/setup notes.
- `docs/EDGE_CASE_MATRIX.md` — edge-case coverage.
- `docs/IMPLEMENTATION_NOTES.md` — implementation notes.

## 8. Git/GitHub Setup for Contributors

After making changes:

```powershell
git status
git add .
git commit -m "Describe your change"
git push
```

Before committing, always check:

```powershell
git status
```

Make sure you are **not** about to commit:

- `.env` files containing secrets
- Python virtual environments
- `node_modules/`
- caches
- build artifacts that are meant to be regenerated
- editor/system files
- private datasets or credentials

## 9. Pulling the Latest Changes

Before starting work:

```powershell
git pull
```

If dependencies changed:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

and:

```powershell
cd ..\extension
npm install
npm run build
```

## 10. Troubleshooting

### `python` is not recognized

Install Python and ensure it is added to PATH.

### PowerShell blocks virtual-environment activation

Run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then activate again:

```powershell
.\backend\.venv\Scripts\Activate.ps1
```

### `npm install` fails

Check:

```powershell
node --version
npm --version
```

Then remove the local dependency directory and lock-file state only if necessary, and reinstall according to the project's package configuration.

### Extension does not load

Check:

- `extension/dist/` exists.
- `extension/dist/manifest.json` exists.
- The browser's extension page shows no manifest errors.
- The build completed successfully.
- Required model files are present in the expected paths.

### Model-related errors

Verify that the expected files under `extension/models/` exist and that the paths used by the extension match the paths generated/copied by the build.

## 11. Security Notes

This repository may process sensitive browser content. Treat secrets and user data carefully.

Do not commit:

```text
.env
API keys
access tokens
passwords
private certificates
private datasets
personal browser data
```

Use `.env.example` for configuration documentation and keep real credentials only in local development or an appropriate secret-management system.

## 12. Contributing

Before opening a pull request:

1. Pull the latest changes.
2. Install/update dependencies.
3. Build the extension.
4. Run the backend locally.
5. Test the extension in the target browser.
6. Check `git status` for accidentally included secrets or generated files.
7. Commit with a clear message and open a pull request.

## 13. License

Add the project's license here before publishing the repository publicly.

## 14. Maintainers

Add the project maintainer/team information here.

---

## Quick Start

For an already-configured machine:

```powershell
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd AirGap

# Backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python main.py
```

In another terminal:

```powershell
cd extension
npm install
npm run build
```

Then load:

```text
AirGap/extension/dist/
```

as an unpacked browser extension.
