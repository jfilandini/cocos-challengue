-- Application changes to the supplied challenge SQL.
-- Original columns retain their nullability; required Prisma fields are a domain assumption.
BEGIN;

-- AlterTable
ALTER TABLE "instruments"
ALTER COLUMN "id" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "marketdata"
ALTER COLUMN "id" SET DATA TYPE BIGINT,
ALTER COLUMN "instrumentid" SET DATA TYPE BIGINT,
ALTER COLUMN "high" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "low" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "open" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "close" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "previousclose" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "orders"
ADD COLUMN     "originalrequest" TEXT,
ADD COLUMN     "transactionid" VARCHAR(100),
ALTER COLUMN "id" SET DATA TYPE BIGINT,
ALTER COLUMN "instrumentid" SET DATA TYPE BIGINT,
ALTER COLUMN "userid" SET DATA TYPE BIGINT,
ALTER COLUMN "price" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "users"
ALTER COLUMN "id" SET DATA TYPE BIGINT;

-- CreateTable
CREATE TABLE "account_snapshots" (
    "userid" BIGINT NOT NULL,
    "settledcash" DECIMAL(38,2) NOT NULL,
    "reservedcash" DECIMAL(38,2) NOT NULL,
    "positions" JSONB NOT NULL,
    "updatedat" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_snapshots_pkey" PRIMARY KEY ("userid")
);

-- CreateIndex
CREATE INDEX "idx_instruments_ticker" ON "instruments"("ticker");

-- CreateIndex
CREATE INDEX "idx_marketdata_instrument_date" ON "marketdata"("instrumentid", "date" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_orders_transaction" ON "orders"("transactionid");

-- CreateIndex
CREATE INDEX "idx_orders_user_status_datetime" ON "orders"("userid", "status", "datetime", "id");

-- CreateIndex
CREATE INDEX "idx_orders_instrumentid" ON "orders"("instrumentid");

-- CreateIndex
CREATE INDEX "idx_users_accountnumber" ON "users"("accountnumber");

-- AddForeignKey
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_userid_fkey" FOREIGN KEY ("userid") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Widen existing sequences without resetting their values or ownership.
ALTER SEQUENCE "users_id_seq" AS BIGINT;
ALTER SEQUENCE "instruments_id_seq" AS BIGINT;
ALTER SEQUENCE "orders_id_seq" AS BIGINT;
ALTER SEQUENCE "marketdata_id_seq" AS BIGINT;

COMMIT;
