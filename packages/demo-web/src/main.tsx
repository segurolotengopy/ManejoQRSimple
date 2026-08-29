/**
 * Punto de entrada de la consola.
 *
 * La configuración llega por variables de Vite. El token queda **dentro del
 * bundle**, visible para cualquiera que abra la página: es aceptable para un
 * demo local en la máquina del dueño, y NO lo es para nada que se publique.
 * Cuando esto salga de la ThinkPad, el verificador de la API pasa a Firebase
 * Auth y este token desaparece (ver packages/functions/README.md).
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { ClienteApi } from './api.js';
import './estilos.css';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
const token = import.meta.env.VITE_API_TOKEN ?? '';

const raiz = document.getElementById('raiz');
if (raiz === null) {
  throw new Error('falta el elemento #raiz en index.html');
}

if (token === '') {
  raiz.innerHTML =
    '<p style="padding:2rem;font-family:system-ui">' +
    'Falta <code>VITE_API_TOKEN</code>. Poné el mismo valor que <code>API_TOKEN_LOCAL</code> ' +
    'de la API en un archivo <code>.env.local</code> de este paquete.</p>';
} else {
  createRoot(raiz).render(
    <StrictMode>
      <App api={new ClienteApi({ baseUrl, token })} />
    </StrictMode>,
  );
}
