// Build de l'accueil React uniquement : sortie figée dans public/assets/home (aucun changement côté Netlify).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'hero',
  publicDir: false,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../public/assets/home',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    rollupOptions: {
      input: 'hero/main.tsx',
      output: { entryFileNames: 'home.js', chunkFileNames: 'home-[name].js', assetFileNames: 'home[extname]' }
    }
  }
});
