# API HTTP del demo

La consola del comerciante habla con esto. **Orquesta; no decide**: cada endpoint
valida su entrada, llama a un caso de uso de `@mqs/qr-core` y traduce el resultado a
HTTP. Ninguna regla de negocio vive acá.

```bash
npm run api      # http://localhost:8787, adaptadores en mock
```

Necesita el emulador corriendo (`npm run demo:ui`) y `API_TOKEN_LOCAL` en el entorno.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/api/cobros` | Crea el cobro y le emite el primer QR. |
| `GET` | `/api/cobros` | Los cobros que el watcher todavía sigue. |
| `GET` | `/api/cobros/:id` | El cobro con su rastro de evidencia completo. |
| `POST` | `/api/cobros/:id/enviar` | Manda el QR al cliente. |
| `POST` | `/api/cobros/:id/renovar` | QR nuevo sobre el mismo cobro (regla #6). |
| `POST` | `/api/cobros/:id/anular` | Anula. Exige un motivo. |
| `POST` | `/api/cobros/:id/comprobante` | Registra el comprobante del cliente. **No confirma.** |
| `POST` | `/api/cobros/:id/verificar` | Le pregunta al banco ahora, sin esperar al satélite. |

El monto entra y sale como **texto decimal** (`"150.50"`), nunca como número: un
`number` de JSON ya perdió cuántos decimales traía y arrastra el error de punto
flotante que la regla #5 prohíbe.

El teléfono del cliente sale **enmascarado** (`+591 7** ***67`, regla #9). La consola
no necesita el número completo para operar.

## Autenticación

**No hay endpoint público.** La consola opera la billetera del dueño; cualquiera que
pueda crear o anular un cobro sin identificarse es un agujero, no una comodidad de
desarrollo. El verificador se resuelve antes de mirar la ruta, así que un pedido sin
token recibe 401 incluso para una ruta inexistente — un 404 antes del 401 le diría a un
desconocido qué rutas existen.

Dos implementaciones, y ninguna es "sin autenticación":

- **`verificadorFirebase`** valida un ID token de Firebase Auth. Es la que va cuando el
  demo salga de la máquina del dueño.
- **`verificadorDeTokenFijo`** compara contra `API_TOKEN_LOCAL`, en tiempo constante
  con `timingSafeEqual` (regla #10). Para el demo local, donde levantar Firebase Auth
  sería desproporcionado.

**La API no arranca sin token configurado.** Un default vacío que "solo es para
desarrollo" es exactamente el tipo de cosa que termina en producción.

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

## Códigos de error

`400` cuerpo inválido · `401` sin token o token equivocado · `404` no existe ·
`405` método que no aplica a la ruta · **`409` el cobro no está en un estado que admita
la operación** · `502` un proveedor externo rechazó · `503` un proveedor externo no
respondió (reintentable).

El `409` merece la distinción: el pedido está bien formado, lo que no corresponde es el
estado. La consola necesita saber si reintentar o refrescar.

## Por qué `node:http` y no Cloud Functions

Los handlers reciben una `Peticion` y devuelven una `Respuesta` —objetos planos, sin
`req`/`res`— así que se prueban llamándolos como funciones, sin levantar un servidor.
El framework queda como un detalle del borde.

Hoy ese borde es un servidor local, que es lo que hace falta para desarrollar y
demostrar, y no agrega ninguna dependencia. El día que esto se despliegue como Cloud
Functions se escribe otro borde de veinte líneas y los handlers no se tocan — el mismo
razonamiento de ADR-002 aplicado al transporte.

Desplegar a Firebase sigue siendo una decisión explícita del dueño.
