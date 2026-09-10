// build.mjs
import { build } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

const builds = [
  { name: 'content', input: 'src/content.js' },
  { name: 'background', input: 'src/background.js' },
  { name: 'popup', input: 'src/popup.js' },
];

for (const [i, entry] of builds.entries()) {
  console.log(`\nBuilding ${entry.name}.js...`);
  await build({
    root,
    build: {
      outDir: 'dist',
      emptyOutDir: i === 0,          // wipe once, on the first entry only
      target: 'es2020',
      minify: false,
      rollupOptions: {
        input: path.resolve(root, entry.input),
        output: { entryFileNames: `${entry.name}.js`, format: 'iife', inlineDynamicImports: true },
      },
    },
    // ⬇ this is the piece that was missing from every actual build run
    plugins: [
      viteStaticCopy({
        targets: [
          { src: 'node_modules/@huggingface/transformers/dist/*.{wasm,mjs}', dest: 'transformers' },
          { src: 'models/ner/*', dest: 'models/ner' },
          { src: 'models/blazeface/*', dest: 'models/blazeface' },
          { src: 'node_modules/@mediapipe/tasks-vision/wasm/*', dest: 'mediapipe/wasm' },
          { src: 'models/privacy-detector/*', dest: 'models/privacy-detector' },
          { src: 'models/ocr/*.tar', dest: 'models/ocr' },
          { src: 'manifest.json', dest: '.' },
          { src: 'popup.html', dest: '.' },
        ],
      }),
    ],
  });
}
console.log('\nBuild completed successfully.');