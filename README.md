# Cocos Challenge Backend

Base inicial con Node.js 24, TypeScript, NestJS 11, Prisma 7 y PostgreSQL 17.
Incluye conexión a la base y `GET /health`. Los endpoints del challenge se implementarán en la siguiente etapa.

## Ejecutar con Docker

Requisitos: Docker Desktop encendido (o Docker Engine con Compose).

```sh
cp .env.example .env
docker compose up --build -d --wait
curl http://localhost:3000/health
```

Respuesta esperada: `{"status":"ok","database":"up"}`.

Si el puerto 3000 está ocupado, cambiar `API_PORT` en `.env` (por ejemplo, a 3001) y usar ese puerto en la URL. `PORT` configura el arranque local de Node; dentro del contenedor siempre se usa 3000.

- `api`: compila y ejecuta la aplicación en el puerto 3000; espera a que PostgreSQL esté disponible.
- `db`: PostgreSQL en el puerto 5432, con volumen persistente `postgres_data`.
- Dentro de Compose la API se conecta a `db:5432`; desde la computadora, Prisma usa `localhost:5432`.
- Los puertos se publican solamente en localhost. Las credenciales de ejemplo son para desarrollo local.

```sh
docker compose logs -f api
docker compose ps
docker compose down
```

`down` conserva los datos. El SQL de `docker/postgres/database.sql` se carga **solo cuando el volumen está vacío**. Modificarlo o reiniciar los servicios no vuelve a cargarlo. `docker compose down -v` elimina los datos locales y permite una inicialización desde cero al levantar nuevamente.

Después de cambiar el código, ejecutar nuevamente `docker compose up --build -d --wait`.

## Desarrollo local

Usar Node.js 24 (`nvm use` si tenés nvm), y copiar `.env.example` a `.env`.

```sh
docker compose up -d db --wait
npm ci
npm run build
npm start
```

Si la API de Docker está corriendo, detenerla con `docker compose stop api` antes de usar su puerto desde Node local.

Para recompilar automáticamente, ejecutar `npm run build:watch` en una terminal y `npm run start:dev` en otra, después del primer build. Este último reinicia Node cuando cambia el código compilado.

```sh
npm run prisma:validate
npm run typecheck
npm run build
npm run prisma:studio
```

## Estructura y decisiones

- `src/database`: proveedor Prisma compartido, con conexión al iniciar y desconexión al cerrar.
- `src/health.controller.ts`: consulta `SELECT 1` mediante Prisma; responde 503 si la base no está disponible.
- `prisma/schema.prisma`: mapeo de las cuatro tablas originales, conservando nulabilidad y precisión decimal.
- `prisma.config.ts`: configuración de conexión para la CLI de Prisma.
- `docker/postgres/database.sql`: contenido original entregado para el challenge, sin modificar.

PostgreSQL convierte los identificadores sin comillas a minúsculas. Los modelos usan `@map` para exponer campos como `userId` sin renombrar columnas. La cotización usa `date`, tal como aparece en el SQL.

Prisma 7 utiliza el adaptador PostgreSQL y genera el cliente en `src/generated/prisma`, excluido de Git y generado durante el build. Referencia: [configuración de Prisma 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).

En esta etapa el esquema se inicializa mediante el SQL original. No se ejecuta `db push` ni se crean migraciones en el arranque. Antes del primer cambio de esquema se preparará el baseline de Prisma Migrate sobre esta base.

El dataset conserva la inconsistencia conocida del usuario 1: BMA tiene una compra ejecutada de 20 acciones y una venta ejecutada de 30. Su tratamiento funcional queda para la implementación del portfolio.

La prueba funcional de envío de órdenes se incorporará junto con ese endpoint.

## Dependencias

La auditoría inicial de npm informa cuatro entradas de severidad alta asociadas a la CLI de Prisma 7.10.0 (`prisma`, `@prisma/config`, `deepmerge-ts` y `mysql2`). Queda pendiente resolverlas con una actualización compatible; no se aplicó el downgrade mayor sugerido por `npm audit fix --force`. La poda de npm conserva la CLI por el árbol de dependencias actual, por lo que los avisos también aparecen con `--omit=dev` y la CLI sigue presente en la imagen.
