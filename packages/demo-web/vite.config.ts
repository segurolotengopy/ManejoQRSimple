import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * La consola corre en 5173, que es el origen que la API permite por CORS
 * (`API_ORIGEN_PERMITIDO`). Si se cambia acá, hay que cambiarlo allá.
 */
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
