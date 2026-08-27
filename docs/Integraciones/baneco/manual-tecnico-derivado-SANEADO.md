> **AVISO DE GOBERNANZA (2026-08-27):** Este es un documento **derivado, no oficial**
> (elaborado con asistencia de IA sobre las fuentes del banco). Copia **saneada**: las
> credenciales fueron sustituidas por marcadores — **también las de certificación que el
> PDF trae como "ejemplo"**, porque la regla #2 del proyecto no admite credenciales en el
> repo y la pregunta A3 al banco plantea que podrían ser credenciales vivas y compartidas.
> Los valores reales viven en el gestor de secretos del dueño y los originales en
> `docs/Integraciones/baneco/privado-no-gh/` (carpeta git-ignored, solo ThinkPad).
> La fuente que **gobierna** el adaptador es la especificación oficial
> "Api Market Baneco v1.3.0" (PDF, en `privado-no-gh/`); ante discrepancia, gana el PDF.
> Su sección de infraestructura AWS/Cloudflare NO aplica a este proyecto (ADR-004: Firebase).
> Ver análisis: `00-analisis-modulo-baneco.md` §2.

# Manual Técnico de Integración y Guía de Codificación: API de Cobros QR Simple (Banco Económico S.A.)

Este documento técnico de referencia está diseñado para guiar la implementación y desarrollo de un módulo de cobros integrado utilizando **Claude Code** y arquitecturas de nube robustas en **AWS** y **Cloudflare**. Toda la información está estrictamente sustentada en las especificaciones oficiales de Banco Económico S.A. [1, 2, 3].

---

## 1. Configuración de Entornos y Parámetros de Red

La comunicación con las APIs del banco se realiza mediante servicios **REST** intercambiando mensajería estructurada en formato **JSON** [3]. Todas las peticiones transaccionales (excepto la autenticación primaria) requieren la cabecera `Authorization: Bearer <token>` [3].

### Tabla Comparativa de Entornos

| Parámetro / Recurso | Ambiente de Certificación (Desarrollo) [5, 6, 14] | Ambiente de Producción (Real) [31, 32] |
| :--- | :--- | :--- |
| **URL Base API Gateway** | `https://apimktdesa.baneco.com.bo/ApiGateway/` | `https://apimkt.baneco.com.bo/apiGateway/` |
| **Usuario Asignado (userName)** | **`<<BANECO_USERNAME_CERT>>`** — valor de ejemplo en el PDF oficial §1, `privado-no-gh/` | **`<<BANECO_USERNAME_PROD — ver gestor de secretos del dueño>>`** |
| **Razón Social Asociada** | N/A | **ALBERDI KULJIS ANDRES** |
| **Llave de Cifrado AES** | **`<<BANECO_AES_KEY_CERT>>`** — valor de ejemplo en el PDF oficial §1, `privado-no-gh/` | **`<<BANECO_AES_KEY_PROD — ver gestor de secretos del dueño>>`** |

### Formatos y Convenciones Obligatorias [4]
*   **CamelCase:** Los nombres de propiedades en JSON deben seguir rigurosamente la notación CamelCase (ej. `transactionId`, `accountCredit`, `qrId`).
*   **Importes:** Representados como decimales con un máximo de **dos dígitos decimales**, empleando exclusivamente el carácter **punto (.)** como separador decimal y omitiendo cualquier separador de miles.
*   **Fechas:** Formato estricto `yyyy-MM-dd` (ej. `2026-08-25`).
*   **Horas:** Formato militar de 24 horas `HH:mm:ss` (ej. `15:00:27`).

---

## 2. Capa Criptográfica y Reversa AES-256-CBC

Para la protección de datos altamente sensibles (`password` de acceso, números de cuenta de abono y códigos de cuenta consultados) [10, 20], el Banco Económico S.A. exige el cifrado bajo el algoritmo estándar **AES de 256 bits (llave de 32 bytes)** [4].

### Descubrimiento del Esquema de Cifrado (Ingeniería de Integración)
Mediante análisis de las respuestas del servicio utilitario de cifrado del banco, se ha determinado con total exactitud que el esquema implementado corresponde a:
*   **Algoritmo:** `AES-256-CBC`
*   **Relleno (Padding):** `PKCS7`
*   **Estructura del Payload Criptográfico:** Un vector de inicialización (**IV**) aleatorio de **16 bytes** es generado para cada operación y se **antepone (prepend)** directamente a los bytes del texto cifrado antes de codificar la secuencia resultante en **Base64**.

### Implementación Práctica de Cifrado/Descifrado

#### Opción A: Implementación en Node.js (Crypto Nativo)
Esta suite de funciones es idónea para programar en Claude Code un módulo integrable ligero en TypeScript o JavaScript:

```javascript
const crypto = require('crypto');

/**
 * Cifra un texto en AES-256-CBC con IV prepended compatible con Baneco.
 * @param {string} plaintext Texto a cifrar.
 * @param {string} aesKeyLlave Llave de 32 caracteres ASCII provista por el banco.
 * @returns {string} Texto cifrado codificado en Base64.
 */
function encryptBaneco(plaintext, aesKeyLlave) {
    const key = Buffer.from(aesKeyLlave, 'utf8'); // Llave de 32 bytes
    const iv = crypto.randomBytes(16); // IV aleatorio de 16 bytes
    
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Concatenar IV + Texto Cifrado y pasar a Base64
    return Buffer.concat([iv, encrypted]).toString('base64');
}

/**
 * Descifra un payload criptográfico compatible con Baneco.
 * @param {string} base64Payload Texto cifrado en Base64 (incluye IV al inicio).
 * @param {string} aesKeyLlave Llave de 32 caracteres ASCII.
 * @returns {string} Texto plano descifrado.
 */
function decryptBaneco(base64Payload, aesKeyLlave) {
    const key = Buffer.from(aesKeyLlave, 'utf8');
    const combinedBytes = Buffer.from(base64Payload, 'base64');
    
    // Extraer los primeros 16 bytes correspondientes al IV
    const iv = combinedBytes.slice(0, 16);
    const encryptedBytes = combinedBytes.slice(16);
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedBytes);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
}
```

#### Opción B: Implementación en Python 3 (Cryptography)
```python
import base64
import os
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.backends import default_backend

def encrypt_baneco(plaintext: str, aes_key: str) -> str:
    key_bytes = aes_key.encode('utf-8')
    iv = os.urandom(16)
    
    # Relleno PKCS7
    padder = padding.PKCS7(128).padder()
    padded_data = padder.update(plaintext.encode('utf-8')) + padder.finalize()
    
    cipher = Cipher(algorithms.AES(key_bytes), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded_data) + encryptor.finalize()
    
    # Prepend IV a los datos cifrados
    combined = iv + ciphertext
    return base64.b64encode(combined).decode('utf-8')

def decrypt_baneco(base64_payload: str, aes_key: str) -> str:
    key_bytes = aes_key.encode('utf-8')
    combined = base64.b64decode(base64_payload)
    
    iv = combined[:16]
    ciphertext = combined[16:]
    
    cipher = Cipher(algorithms.AES(key_bytes), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    padded_plaintext = decryptor.update(ciphertext) + decryptor.finalize()
    
    # Quitar relleno PKCS7
    unpadder = padding.PKCS7(128).unpadder()
    plaintext = unpadder.update(padded_plaintext) + unpadder.finalize()
    return plaintext.decode('utf-8')
```

---

## 3. Protocolo de Autenticación y Gestión de Tokens (JWT)

Antes de invocar cualquier método transaccional de cobro o consulta, el módulo debe negociar de forma obligatoria un JSON Web Token (JWT) [3, 33].

*   **Método:** `POST`
*   **Endpoint:** `/api/authentication/authenticate` [7]
*   **Headers:**
    ```http
    Content-Type: application/json
    ```

### Estructura de Petición (Request Body) [7]
El campo `password` debe ser enviado cifrado bajo la llave AES del entorno correspondiente utilizando el método descrito en la Sección 2 [7].

```json
{
  "userName": "<<BANECO_USERNAME_PROD — ver gestor de secretos del dueño>>",
  "password": "<<password cifrado en AES-256-CBC y codificado Base64 — ejemplo en el PDF oficial §3>>"
}
```

### Estructura de Respuesta (Response Body) [7]
Retorna un token de autorización Bearer de tiempo limitado [3, 7].

```json
{
  "token": "<<JWT Bearer de vigencia limitada — ejemplo en el PDF oficial §3>>",
  "responseCode": 0,
  "message": ""
}
```
*   *Nota:* Si el `responseCode` es diferente de `0`, se ha producido un error de validación de credenciales, cuyo detalle se describe en el campo `message` [7].

---

## 4. Módulo de Cobros QR Simple (Transaccional)

Este módulo expone las operaciones transaccionales para crear y anular los códigos de cobro en la pasarela "Pago Simple" [9].

### 4.1. Generación de Código QR (`POST`) [9]
Permite generar una imagen del código QR codificada en Base64 a partir de los datos transaccionales del comercio [11, 33].

*   **Endpoint:** `/api/qrsimple/generateQR` [9]
*   **Headers:**
    ```http
    Content-Type: application/json
    Authorization: Bearer <token_jwt>
    ```

#### Request Body - Validación Estricta de Parámetros [10, 32]
Debes configurar las restricciones de longitud de caracteres en tu cliente o formulario antes de remitir la trama de datos para evitar desbordamientos o rechazos en el API Gateway:

| Propiedad | Tipo de Dato | Requerido | Longitud Máxima / Formato | Descripción |
| :--- | :--- | :---: | :--- | :--- |
| `transactionId` | Texto | **Sí** | Máx. 30 caracteres | Identificador único del cobro en el sistema del comercio [10]. |
| `accountCredit` | Texto | **Sí** | Máx. 10 caracteres *(Cifrado)* | Número de cuenta bancaria destino donde se acreditará el cobro. **Debe ir cifrado** [10]. |
| `currency` | Texto | **Sí** | Estricto 3 caracteres | Moneda del cobro. Valores válidos: `BOB` (Bolivianos) o `USD` (Dólares) [10]. *(Nota: Corregir el typo "USB" del documento original)* |
| `amount` | Decimal | **Sí** | Formato `#.##` | Importe monetario con máximo 2 posiciones decimales y punto separador [10]. |
| `description` | Texto | No | Máx. 100 caracteres | Concepto o glosa visible para el cliente al escanear [10]. |
| `dueDate` | Fecha | **Sí** | `yyyy-MM-dd` | Fecha límite de validez para el cobro del código QR [10]. |
| `singleUse` | Lógico | **Sí** | `true` o `false` | `true`: permite un único pago (Recomendado). `false`: cobro recurrente [10]. |
| `modifyAmount` | Lógico | **Sí** | `true` o `false` | `true`: permite al cliente cambiar el importe. `false`: pago estricto por el monto exacto [10]. |
| `branchCode` | Texto | No | Máx. 5 caracteres | Código interno de sucursal del comercio [10]. |

#### Request Body (Ejemplo) [11, 12]:
```json
{
  "transactionId": "ORD-2026-00987",
  "accountCredit": "<<cuenta de abono cifrada en AES-256-CBC, Base64 — regla #4: nunca en el repo>>",
  "currency": "BOB",
  "amount": 150.50,
  "description": "Pago Factura de Prueba 00987",
  "dueDate": "2026-12-31",
  "singleUse": true,
  "modifyAmount": false,
  "branchCode": "E0001"
}
```

#### Response Body (Ejemplo) [11]:
```json
{
  "qrId": "21061401016000000003",
  "qrImage": "iVBORw0KGgoAAAANSUhEUgAAB5QAAAeUCAYAAACZoCvZA...",
  "responseCode": 0,
  "message": ""
}
```

### 4.2. Anulación de Código QR (`DELETE`) [12]
Permite deshabilitar de forma inmediata un QR que aún no ha sido pagado, evitando transacciones tardías o duplicidades [12].

*   **Endpoint:** `/api/qrsimple/cancelQR` [12]
*   **Restricción:** Solo permite anular códigos creados con `singleUse: true` que sigan vigentes y pendientes, o códigos con `singleUse: false` [12].

#### Request Body [13]:
```json
{
  "qrId": "21061401016000000003"
}
```

#### Response Body [13]:
```json
{
  "responseCode": 0,
  "message": ""
}
```

---

## 5. Verificación de Destino y Validación Robustecida de Pagos

Para garantizar con seguridad bancaria que el dinero ha sido debitado y acreditado con éxito en la cuenta de destino, el sistema expone tres mecanismos concurrentes: un webhook, una consulta de estado y un reporte diario de conciliación [14, 15, 17].

```
┌────────────────────────────────────────────────────────┐
│             Esquema de Validación de Pagos             │
├───────────────────┬────────────────────────────────────┤
│ Método Primario   │ Webhook Asíncrono (Push Real-Time) │
├───────────────────┼────────────────────────────────────┤
│ Método Secundario │ Polling Síncrono (Consulta Estado) │
├───────────────────┼────────────────────────────────────┤
│ Método de Cierre  │ Conciliación Batch (Reporte Diario)│
└───────────────────┴────────────────────────────────────┘
```

### 5.1. Validación Pasiva: Webhook de Notificación en Tiempo Real (Push) [15]
Este es el mecanismo óptimo para cerrar transacciones automáticamente sin sobrecargar la infraestructura del banco ni la del comercio. El comercio expone un endpoint seguro expuesto a internet [15].

*   **Método:** `POST`
*   **URI de Escucha:** `/api/qrsimple/notifyPaymentQR` [15]
*   **Payload Entrante del Banco:** Contiene el objeto enriquecido `PaymentQR` [16, 25].

```json
{
  "payment": {
    "qrId": "22113001016800000017",
    "transactionId": "3161056",
    "paymentDate": "2022-11-30T00:00:00",
    "paymentTime": "15:00:27",
    "currency": "USD",
    "amount": 1.20,
    "senderBankCode": "1016",
    "senderName": "ALBERDI KULJIS ANDRES",
    "senderDocumentId": "0",
    "senderAccount": "******5691",
    "description": "Ejemplo generacion de QR",
    "branchCode": "E0001"
  }
}
```

#### Respuesta Esperada por el Banco [17]:
Tu webhook debe retornar de forma inmediata un código HTTP `200 OK` con la siguiente estructura estructurada JSON. Cualquier otra respuesta o retraso mayor a 5 segundos obligará al banco a reintentar el envío bajo políticas internas:
```json
{
  "responseCode": 0,
  "message": ""
}
```

### 5.2. Verificación Activa: Consulta de Estado de QR (Polling / Fallback) [13]
Ideal para escenarios donde el Webhook no se ejecute a tiempo, la sesión web del usuario esté a punto de expirar, o se requiera un refresco manual en la interfaz del comercio [13].

*   **Método:** `GET`
*   **Endpoint:** `/api/qrsimple/v2/statusQR/{id}` [13] (Usa la versión 2 estandarizada en la actualización de la API [2])

#### Ejemplo de URL:
`https://apimkt.baneco.com.bo/apiGateway/api/qrsimple/v2/statusQR/21061401016000000006` [14]

#### Estructura de Respuesta exitosa (Pago Completado):
```json
{
  "statusQrCode": 1,
  "payment": [
    {
      "qrId": "21061401016000000006",
      "transactionId": "1236342",
      "paymentDate": "2021-06-14T00:00:00",
      "paymentTime": "17:06:29",
      "currency": "BOB",
      "amount": 150.50,
      "senderBankCode": "1016",
      "senderName": "PEDRO PEREZ",
      "senderDocumentId": "0",
      "senderAccount": "******1913",
      "description": "Pago Factura de Prueba 00987",
      "branchCode": "E0001"
    }
  ],
  "responseCode": 0,
  "message": ""
}
```
*   **Mapeo de Estados (`statusQrCode`)** [14]:
    *   `0`: Activo, pendiente de pago.
    *   `1`: Pagado.
    *   `9`: Anulado.

### 5.3. Conciliación de Cierre de Caja Batch (`GET`) [17]
Permite contrastar diariamente a nivel de base de datos la integridad de todos los cobros devengados [17].

*   **Endpoint:** `/api/qrsimple/v2/paidQR/{fecha}` [17]
*   **Formato de Fecha:** `yyyyMMdd` [18]

#### Ejemplo de URL:
`https://apimkt.baneco.com.bo/apiGateway/api/qrsimple/v2/paidQR/20260825` [18]

#### Payload de Retorno:
```json
{
  "paymentList": [
    {
      "qrId": "21070201016000000006",
      "transactionId": "1236392",
      "paymentDate": "2021-07-19T00:00:00",
      "paymentTime": "13:34:28",
      "currency": "BOB",
      "amount": 2.5,
      "senderBankCode": "1016",
      "senderName": "PEDRO PEREZ",
      "senderDocumentId": "0",
      "senderAccount": "******1913",
      "description": "Ejemplo generacion de QR",
      "branchCode": "E0001"
    }
  ],
  "responseCode": 0,
  "message": ""
}
```

---

## 6. Arquitectura de Despliegue AWS, Cloudflare y DevSecOps

Para elevar el nivel de seguridad al estándar bancario regulado por la ASFI, la infraestructura debe ser completamente aislada y monitorizada.

```
                  ┌──────────────────────────────┐
                  │          Internet            │
                  └──────────────┬───────────────┘
                                 │ HTTPS (443)
                  ┌──────────────▼───────────────┐
                  │       Cloudflare WAF         │ (DDoS, TLS Term, CORS,
                  └──────────────┬───────────────┘  IP Whitelisting, Rate Limiting)
                                 │
                  ┌──────────────▼───────────────┐
                  │    AWS ALB / API Gateway     │
                  └──────────────┬───────────────┘
                                 │ (VPC Privada)
                  ┌──────────────▼───────────────┐
                  │  AWS ECS Fargate / Lambda    │ <─── [ AWS Secrets Manager ]
                  └──────────────┬───────────────┘      (Guarda AES Key de Producción)
                                 │ (No Internet)
                  ┌──────────────▼───────────────┐
                  │  Aurora DB / KMS Encryption  │
                  └──────────────────────────────┘
```

### 1. AWS (Cómputo Seguro y Custodia de Secretos)
*   **AWS Secrets Manager:** La llave AES de producción (`<<BANECO_AES_KEY_PROD — ver gestor de secretos del dueño>>`) y las credenciales de acceso jamás deben colocarse en duro en el código de Claude Code. Deben cargarse en ejecución mediante el SDK de AWS utilizando roles IAM con políticas de mínimo privilegio.
*   **AWS ECS Fargate:** El microservicio debe desplegarse en contenedores dentro de una VPC en subredes privadas. El tráfico de entrada debe ser canalizado únicamente por un Application Load Balancer (ALB).

### 2. Cloudflare (Protección Perimetral de Notificaciones)
*   **Whitelisting de Direcciones IP:** El webhook `/api/qrsimple/notifyPaymentQR` debe configurarse para recibir conexiones *únicamente* provenientes del bloque de direcciones IP públicas de Banco Económico S.A., previniendo ataques de inyección externos.
*   **Rate Limiting Estricto:** Mitigar ataques de denegación de servicios dirigidos a los endpoints de verificación de transacciones.
*   **CORS y Cabeceras de Seguridad:** Implementación rigurosa de cabeceras HSTS, X-Frame-Options y Content Security Policy (CSP).

### 3. DevSecOps en GitHub Pro
*   **GitHub Advanced Security (GHAS):**
    *   **Secret Scanning:** Configurar reglas personalizadas en GitHub Pro para evitar fugas de llaves en repositorios públicos o privados. Cualquier intento de subir código que contenga la llave `<<BANECO_AES_KEY_PROD — ver gestor de secretos del dueño>>` gatillará el bloqueo inmediato del commit.
    *   **Análisis CodeQL (SAST):** Integrado en GitHub Actions para verificar la robustez matemática del cifrado de datos, saneamiento de entradas ante ataques de inyección y prevenir la deserialización insegura.
