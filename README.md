# StockAgent-Web

Nueva aplicación TypeScript, separada del programa Python de referencia y preparada para evolucionar a SaaS multi-tenant. PostgreSQL será la única fuente de verdad: no se sincronizará con `Productos.xlsx` ni se exportarán archivos `.xls` heredados.

## Plan de fases

0. **Fundación del monorepo (completada):** npm workspaces; API Fastify; web React/Vite con Tailwind y PWA; paquete compartido Zod; configuración local reproducible.
1. **Dominio y persistencia (completada):** modelar productos, movimientos, pedidos, planes, chat, clientes, usuarios, tenants y auditoría en PostgreSQL con Drizzle ORM, migraciones SQL y políticas Row-Level Security (`app.current_tenant_id`). Toda tabla de negocio tiene `tenant_id`; aislamiento y autorización por tenant desde los repositorios.
2. **Carga y procesamiento (completada):** carga de archivos desde la PC (`POST /api/v1/files/upload`), almacenamiento intercambiable Local/S3 (`STORAGE_DRIVER=local|s3`), registro de archivos con SHA-256 contra duplicados, consolidación, simulación sin escrituras (`POST /api/v1/ingestion/simulate`) y confirmación transaccional en PostgreSQL (`POST /api/v1/ingestion/confirm`).
3. **Parsers e integraciones (completada):** parsers TypeScript para remitos PDF mayoristas (`pdfjs-dist`), Canjes XLSX/XLS/CSV, Mercado Libre DOCX (`jszip`/`fast-xml-parser` + matching fuzzy) y conector OAuth2/API en PostgreSQL (`tenant_settings` cifrado con AES-256-GCM), Mercado Full XLSX/XLS/CSV (`xls-reader`/`exceljs`), Ingreso de Fábrica XLSX/XLS/CSV/PDF y Stock Físico XLSX/XLS/CSV.
4. **API y operación móvil (completada):** endpoints compatibles con Flutter (`/api/v1/auth/*`, `/api/v1/productos/*`, `/api/v1/inventario/*`, `/api/v1/despacho/*`, `/api/v1/sistema/*`, `/api/v1/chat/*`, `/api/v1/notificaciones/*`), RBAC, SoD y hashes importados PBKDF2-HMAC-SHA256 (`600_000` iteraciones). Adaptadores intercambiables en memoria y BullMQ/Redis (`QUEUE_DRIVER`, `EVENT_BUS_DRIVER`) más WebSockets multi-tenant (`/api/v1/ws`).
5. **Experiencia web (completada):** aplicación React + Tailwind CSS PWA (`apps/web`) con autenticación multi-tenant, dashboard en tiempo real (`WS /api/v1/ws`), catálogo y ajustes por SKU/código de barras, cargas drag-and-drop desde PC con previsualización/simulación antes de confirmar (`POST /api/v1/parsers/upload-and-simulate` -> `/api/v1/ingestion/confirm`), inventario físico en vivo, escáner cámara (`BarcodeDetector`) + lector USB HID, despacho QR con cola offline (`localStorage` + `escanear-lote`) y consola administrativa/Mercado Libre según RBAC/SoD.
6. **SaaS y producción (completada):** aislamiento RLS auditado sobre todas las tablas multi-tenant, cuotas y aprovisionamiento SaaS (`/api/v1/saas/tenants`, `/api/v1/saas/usage`), observabilidad (`/ready`, `/metrics` Prometheus, `X-Request-Id` y redacción de secretos en logs), copias de seguridad firmadas SHA-256 + `pg_dump` (`npm run backup:tenant`), controles de seguridad HTTP (cabeceras, rate limiter global, anti-SSRF y chequeo productivo en arranque), migración inicial desde Excel/usuarios Python (`npm run migrate:legacy`) y despliegue Docker Compose (`api` + `web` Nginx PWA + PostgreSQL 18 + Redis).

Las reglas de negocio deben contrastarse con `Agentes`; no se copiará su persistencia Excel/SQLite ni sus secretos o datos. La migración de usuarios y la compatibilidad completa del cliente Flutter se implementarán en sus fases, no se presuponen en este esqueleto.

## Estructura

```text
apps/
  api/       Fastify, Zod, Drizzle, PostgreSQL y WebSockets
  web/       React, Vite, Tailwind CSS y PWA con service worker propio
packages/
  shared/    contratos Zod y tipos compartidos
```

Los adaptadores de almacenamiento y colas se añadirán detrás de interfaces cuando se implemente la fase de cargas; no hay proveedor externo obligatorio para el desarrollo inicial.

## Requisitos y comandos

- Node.js `>=22.12` (verificado inicialmente con Node 26) y npm.
- PostgreSQL 18 para las fases que requieran persistencia.

```powershell
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
npm run typecheck
npm run build
npm test
npm run backup:tenant -- --tenant default
npm run migrate:legacy -- --tenant default --excel ./Productos.xlsx
docker compose up --build -d
```

La API expone `GET /health`, `GET /api/v1/health`, `GET /ready`, `GET /api/v1/ready`, `GET /metrics`, `/api/v1/auth/*`, `/api/v1/productos/*`, `/api/v1/inventario/*`, `/api/v1/despacho/*`, `/api/v1/sistema/*`, `/api/v1/chat/*`, `/api/v1/notificaciones/*`, `/api/v1/auditoria`, `WS /api/v1/ws`, `/api/v1/files/*`, `/api/v1/ingestion/*`, `/api/v1/parsers/*`, `/api/v1/integrations/mercadolibre/*` y `/api/v1/saas/*`. Los scripts cargan `.env` automáticamente a partir de `.env.example` cuando existe. No guardes credenciales reales en el repositorio.
