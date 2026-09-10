import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "chrome120",
    minify: false,
    rollupOptions: {
      output: {
        format: "es"
      }
    }
  },
  optimizeDeps: {
    exclude: [
      "@huggingface/transformers",
      "webextension-polyfill"
    ]
  }
});