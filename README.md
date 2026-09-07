# Cocos Challenge Backend

Base inicial con Node.js 24, TypeScript, NestJS 11, Prisma 7 y PostgreSQL 17.
Incluye conexión a la base, `GET /health`, búsqueda de activos con `GET /instruments` y portfolio con `GET /users/:userId/portfolio`.

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

## Buscar activos

```sh
curl 'http://localhost:3000/instruments?query=ypf'
curl 'http://localhost:3000/instruments?query=molinos'
```

Usar el puerto configurado en `API_PORT` (3001 si se eligió ese valor).
El parámetro `query` es obligatorio: entre 1 y 255 caracteres luego de quitar espacios al inicio y al final. Busca coincidencias parciales por ticker **o** nombre, sin distinguir mayúsculas y minúsculas. Los acentos se conservan y los caracteres `%`, `_` y `\` se buscan literalmente.

La respuesta es un array de objetos `{ id, ticker, name, type }` ordenados por ticker. Solo incluye instrumentos de tipo `ACCIONES`; ARS es saldo de efectivo y queda excluido. Si no hay coincidencias, devuelve `[]`. Una búsqueda ausente, vacía o inválida devuelve HTTP 400.

Las pruebas funcionales usan la base con el SQL original y no modifican datos:

```sh
docker compose up -d db --wait
npm run test:instruments
```

## Estructura y decisiones

La aplicación usa arquitectura hexagonal organizada por funcionalidad. El dominio y los casos de uso no importan NestJS, Prisma ni componentes de infraestructura.

```text
src/instruments/
  domain/instrument.ts                         Modelo independiente de Prisma
  application/search-instruments.use-case.ts   Caso de uso y validación
  application/ports/instrument.repository.ts   Puerto de salida
  infrastructure/http/                        Adaptador de entrada HTTP
  infrastructure/persistence/                 Adaptador de salida Prisma
  instruments.module.ts                       Composición e inyección de dependencias
```

El controlador invoca el caso de uso y convierte errores de entrada en HTTP 400. El caso de uso depende del contrato `InstrumentRepository`; el módulo NestJS lo conecta con `PrismaInstrumentRepository` mediante una fábrica. El adaptador Prisma implementa la búsqueda y el escape de patrones SQL, devolviendo modelos propios. La misma operación puede invocarse desde otro adaptador sin depender de HTTP.

`npm run test:unit` prueba los casos de uso y cálculos sin iniciar NestJS ni PostgreSQL. `npm run test:instruments` ejecuta las pruebas de búsqueda; `npm test` ejecuta toda la suite, incluyendo las funcionales con la base del challenge.

- `src/shared/infrastructure/database`: proveedor Prisma compartido, con conexión al iniciar y desconexión al cerrar.
- `src/shared/infrastructure/http/health.controller.ts`: consulta `SELECT 1` mediante Prisma; responde 503 si la base no está disponible. Es una comprobación de infraestructura, sin lógica de negocio.
- `prisma/schema.prisma`: mapeo de las cuatro tablas originales, conservando nulabilidad y precisión decimal.
- `prisma.config.ts`: configuración de conexión para la CLI de Prisma.
- `docker/postgres/database.sql`: contenido original entregado para el challenge, sin modificar.

PostgreSQL convierte los identificadores sin comillas a minúsculas. Los modelos usan `@map` para exponer campos como `userId` sin renombrar columnas. La cotización usa `date`, tal como aparece en el SQL.

Prisma 7 utiliza el adaptador PostgreSQL y genera el cliente en `src/generated/prisma`, excluido de Git y generado durante el build. Referencia: [configuración de Prisma 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).

En esta etapa el esquema se inicializa mediante el SQL original. No se ejecuta `db push` ni se crean migraciones en el arranque. Antes del primer cambio de esquema se preparará el baseline de Prisma Migrate sobre esta base.

El dataset conserva la inconsistencia conocida del usuario 1: BMA tiene una compra ejecutada de 20 acciones y una venta ejecutada de 30. El tratamiento se documenta en la sección Portfolio.

La prueba funcional de envío de órdenes se incorporará junto con ese endpoint.

## Dependencias

La auditoría inicial de npm informa cuatro entradas de severidad alta asociadas a la CLI de Prisma 7.10.0 (`prisma`, `@prisma/config`, `deepmerge-ts` y `mysql2`). Queda pendiente resolverlas con una actualización compatible; no se aplicó el downgrade mayor sugerido por `npm audit fix --force`. La poda de npm conserva la CLI por el árbol de dependencias actual, por lo que los avisos también aparecen con `--omit=dev` y la CLI sigue presente en la imagen.

## Portfolio

```sh
curl 'http://localhost:3001/users/1/portfolio'
npm run test:portfolio
npm test
```

El puerto debe coincidir con `API_PORT`. La respuesta incluye `totalValue`, `cashBalance`, `reservedCash`, `availableCash` y `positions`. Los importes y porcentajes se serializan como strings decimales con dos decimales; las cantidades de acciones son enteros. El cálculo usa decimal.js con precisión de 40 dígitos y redondea al responder.

- Solo los movimientos `FILLED` modifican saldo, cantidad y costo. Esto incluye LIMIT ejecutadas. `REJECTED` y `CANCELLED` se ignoran.
- Los ingresos y egresos ARS usan `size`; compras y ventas usan `size × price`.
- Las compras LIMIT `NEW` reservan pesos y las ventas LIMIT `NEW` reservan acciones. Es una decisión de diseño: las reservas reducen disponibilidad, sin reducir el valor total de la cuenta.
- `totalValue = cashBalance + suma(quantity × último close)`. La cotización se elige por `date` descendente e `id` como desempate, sin exigir la fecha de hoy.
- `totalReturnPercent` es el rendimiento no realizado de la posición abierta: `(valor de mercado − costo remanente) / costo remanente × 100`. Las compras suman costo; las ventas descuentan cantidad al costo promedio vigente, sin usar el precio de venta como costo. Una posición cerrada se omite y al reabrirse inicia un nuevo costo. No incluye ganancias realizadas, comisiones ni impuestos.
- `dailyReturnPercent = (close − previousClose) / previousClose × 100`; devuelve `null` si falta el cierre anterior o no es mayor que cero.
- Sin cotización válida para una posición abierta se responde HTTP 503, evitando devolver una valuación incompleta. Movimientos relevantes incompletos o inválidos producen HTTP 422. Usuario inexistente devuelve 404 e identificador inválido devuelve 400.
- La lectura de usuario, movimientos y cotizaciones se realiza en una transacción `RepeatableRead`, para obtener un snapshot consistente.

El usuario 1 del SQL original tiene `cashBalance = "753000.00"`, `reservedCash = "125500.00"`, `availableCash = "627500.00"` y `totalValue = "889756.00"`. Incluye BMA con −10 acciones: se conserva el saldo firmado y su valor de mercado negativo, con `inconsistentHistory: true` y `totalReturnPercent: null`. El total refleja literalmente ese historial inconsistente. Los usuarios 2, 3 y 4 tienen valores cero y posiciones vacías.

La funcionalidad sigue la misma arquitectura hexagonal: cálculo en `portfolio/domain`, caso de uso y puerto en `portfolio/application`, HTTP y Prisma en `portfolio/infrastructure`. El dominio no importa NestJS ni Prisma.
