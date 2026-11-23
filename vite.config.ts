import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // L'alias conserve les noms utilisés par les écrans. Leur rendu vient de Tabler.
    alias: [{ find: /^lucide-react$/, replacement: fileURLToPath(new URL('./src/components/Icons.ts', import.meta.url)) }],
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return;
          if (id.includes('xlsx')) return 'xlsx';
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('@tabler/icons-react')) return 'icons';
          if (id.includes('react-dom')) return 'react-dom';
          if (id.includes('/node_modules/react/')) return 'react';
        },
      },
    },
  },
});
