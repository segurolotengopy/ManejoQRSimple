# ManejoQRSimple

Sistema modular de cobros por **QR Simple (Bolivia)** sobre la billetera
**Yape — BCP Bolivia**: genera y renueva QRs de cobro, los envía a los clientes
por WhatsApp mediante **WhatsAppModular**, recibe comprobantes y confirma los
pagos contra la consola web de la billetera hasta contar con una API oficial.
Proyecto del ecosistema **SeguroLoTengo** — Bolivia (+591).

> Estado: **documentación de arranque**. El código todavía no está implementado;
> este repositorio contiene la arquitectura, las guías y la configuración de
> desarrollo listas para empezar. Ver `docs/ESTADO.md`.

## Empezar acá

1. **Lee [`docs/00-INDICE.md`](docs/00-INDICE.md)** — el mapa de toda la documentación.
2. Antes de escribir código, lee [`CLAUDE.md`](CLAUDE.md) y
   [`docs/01-arquitectura.md`](docs/01-arquitectura.md).
3. Para arrancar con Claude Code, sigue
   [`PROMPTS_CLAUDE_CODE.md`](PROMPTS_CLAUDE_CODE.md) en orden.

## Instalación

```bash
git clone git@github.com:AndresAlberdi/ManejoQRSimple.git
cd ManejoQRSimple
npm ci
cp .env.example .env      # completar con tus valores; .env no se versiona
chmod +x .claude/hooks/*.sh
npm test
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | demo-web + emuladores de Firebase |
| `npm test` | Suite completa de Vitest (objetivo: < 10 s) |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm run deps:check` | Valida la regla de dependencias entre módulos |
| `npm run scraper:dry` | Scraper en modo lectura, sin escribir a Firestore |

## Arquitectura en 30 segundos

```
Dueño (Yape BCP) ──QR──► qr-core ──wa-bridge──► WhatsAppModular ──► Cliente
                            ▲                                        │
                            │ conciliación                comprobante│
                    yape-scraper (Playwright,                        ▼
                    SOLO LECTURA, ThinkPad→OCI)              webhook wa-bridge
                            │
                    Consola web Yape BCP          Firestore = estado y evidencia
```

Detalle en [`docs/01-arquitectura.md`](docs/01-arquitectura.md).

## Reglas que no se negocian

1. Solo la consola de la billetera (o futura API oficial) confirma un pago.
   Un comprobante de WhatsApp **nunca** confirma nada por sí mismo.
2. Credenciales bancarias jamás en el repo, `.env`, logs, Firestore ni la nube.
3. El scraper es de solo lectura y sus selectores se mapean de capturas reales.
4. Montos en centavos enteros. Todo QR tiene vencimiento y renovación versionada.
5. `crypto.randomInt()`, nunca `Math.random()`. `timingSafeEqual()`, nunca `===`.

Ver [`docs/06-seguridad.md`](docs/06-seguridad.md).

## Desarrollo con Claude Code

El repositorio incluye `CLAUDE.md`, subagentes en `.claude/agents/`, comandos
slash en `.claude/commands/` y hooks de protección en `.claude/hooks/`.
Verifica que se cargaron con `/agents` y `/hooks`.

## Licencia

Propietario — Andres Alberdi / SeguroLoTengo. Todos los derechos reservados.
