import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // onnxruntime-web ships its own WASM loader; pre-bundling it breaks the asset paths.
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
