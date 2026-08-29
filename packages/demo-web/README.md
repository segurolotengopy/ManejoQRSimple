# Consola del comerciante

React + Vite sobre la API del demo. Crear un cobro, verlo, enviarlo, renovarlo, anularlo
y preguntarle al banco — con el rastro de evidencia de cada cobro a la vista.

## Levantarla

Tres cosas, en tres terminales:

```bash
npm run demo:ui    # 1. emulador de Firestore
npm run api        # 2. API en :8787
npm run dev        # 3. consola en :5173
```

La consola necesita un `.env.local` **en este paquete** con el mismo token que usa la API:

```
VITE_API_URL=http://localhost:8787
VITE_API_TOKEN=<el mismo valor que API_TOKEN_LOCAL>
```

Está git-ignored. Si falta, la consola lo dice en pantalla en vez de fallar en silencio.

## El token queda dentro del bundle

Vite embebe las variables en tiempo de compilación, así que **`VITE_API_TOKEN` es visible
para cualquiera que abra la página**. Es aceptable para un demo local en la máquina del
dueño; **no lo es para nada que se publique**.

Cuando esto salga de la ThinkPad, el verificador de la API pasa a Firebase Auth
(`verificadorFirebase`, ya implementado) y este token desaparece. Ver
[`packages/functions/README.md`](../functions/README.md).

## Sin lógica de negocio

La restricción del paquete no es decorativa, y acá se cumple así:

- **`api.ts`** — cliente HTTP. Devuelve errores como valores, nunca como excepciones: una
  promesa rechazada dentro de un `onClick` desaparece sin dejar rastro.
- **`formato.ts`** — traducción a texto: descripciones de estado, montos, vigencias.
- **`App.tsx`** — componentes delgados que piden y muestran.

Los dos primeros son TypeScript plano, sin React, así que se prueban sin DOM ni jsdom.
Por eso este paquete no necesita `@testing-library` ni `jsdom`.

**`accionesPosibles()` no es la regla de negocio.** Decide qué botones mostrar, pero el
que decide de verdad es el dominio, que responde `409` a cualquier cosa que no
corresponda. Si los dos quedaran desalineados, manda el dominio — por eso la consola
siempre muestra el error que devuelve la API en vez de esconderlo.

Y no hay ningún botón "confirmar": la única vía a `CONFIRMADO` es la conciliación
(regla #1). Un botón así en la consola sería exactamente el agujero que el dominio
impide. Hay un test que lo afirma para todos los estados.

## Si `npm run dev` falla con ENOSPC

El servidor de desarrollo de Vite vigila archivos con inotify, y en máquinas con
`fs.inotify.max_user_instances` agotado revienta:

```bash
sudo sysctl fs.inotify.max_user_instances=512
```

Mientras tanto se puede servir el bundle compilado, que no vigila nada:

```bash
npm run build:app -w @mqs/demo-web
npx vite preview --port 5173
```
