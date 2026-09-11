// build.mjs
import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const root = path.dirname(fileURLToPath(import.meta.url));

import { patchEmbindForCSP, postProcessDistForCSP } from './patch-csp.mjs';

await patchEmbindForCSP();

const builds = [
  { name: 'content', input: 'src/content.js' },
  { name: 'background', input: 'src/background.js' },
  { name: 'popup', input: 'src/popup.js' },
  { name: 'offscreen', input: 'offscreen.js' },
];

for (const [i, entry] of builds.entries()) {
  console.log(`\nBuilding ${entry.name}.js...`);
  await build({
    root,
    build: {
      outDir: 'dist',
      emptyOutDir: i === 0, // wipe once, on the first entry only
      target: 'es2020',
      minify: false,
      rollupOptions: {
        input: path.resolve(root, entry.input),
        output: { entryFileNames: `${entry.name}.js`, format: 'es', inlineDynamicImports: true },
      },
    },
  });
}

console.log('\nCopying static assets...');

// 1. Copy manifest and HTML files
for (const file of ['manifest.json', 'popup.html', 'offscreen.html']) {
  await fs.copyFile(path.resolve(root, file), path.resolve(root, 'dist', file));
}

// 1b. Copy test-page directory
try {
  await fs.cp(path.resolve(root, 'test-page'), path.resolve(root, 'dist/test-page'), { recursive: true, force: true });
} catch (e) {
  console.warn('Warning copying test-page:', e);
}

// 2. Copy models/ directory (blazeface, ner, ocr, privacy-detector) directly into dist/models
await fs.cp(
  path.resolve(root, 'models'),
  path.resolve(root, 'dist/models'),
  {
    recursive: true,
    force: true,
    filter: (src) => !src.includes('.cache')
  }
);

// 3. Copy mediapipe wasm files directly into dist/mediapipe/wasm
const mediapipeWasmSrc = path.resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const mediapipeWasmDest = path.resolve(root, 'dist/mediapipe/wasm');
await fs.mkdir(mediapipeWasmDest, { recursive: true });
await fs.cp(mediapipeWasmSrc, mediapipeWasmDest, { recursive: true, force: true });

// Copy mediapipe genai wasm files directly into dist/mediapipe/genai-wasm
const genaiWasmSrc = path.resolve(root, 'node_modules/@mediapipe/tasks-genai/wasm');
const genaiWasmDest = path.resolve(root, 'dist/mediapipe/genai-wasm');
await fs.mkdir(genaiWasmDest, { recursive: true });
await fs.cp(genaiWasmSrc, genaiWasmDest, { recursive: true, force: true });

// 4. Copy onnxruntime-web WASM & MJS files directly into dist/transformers
const ortDist = path.resolve(root, 'node_modules/onnxruntime-web/dist');
const transformersDist = path.resolve(root, 'dist/transformers');
await fs.mkdir(transformersDist, { recursive: true });
const ortFiles = await fs.readdir(ortDist);
for (const file of ortFiles) {
  if (file.startsWith('ort-wasm')) {
    await fs.copyFile(
      path.join(ortDist, file),
      path.join(transformersDist, file)
    );
  }
}

await postProcessDistForCSP();

console.log('\nBuild completed successfully.');