/*
  Warnings:

  - Added the required column `updatedAt` to the `Coupon` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'cod_pending';
ALTER TYPE "PaymentStatus" ADD VALUE 'cod_collected';

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "area" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "division" TEXT,
ADD COLUMN     "dropAddress" TEXT,
ADD COLUMN     "thana" TEXT,
ALTER COLUMN "city" DROP NOT NULL,
ALTER COLUMN "state" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "usageCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "usageLimit" INTEGER,
ADD COLUMN     "userUsageLimit" INTEGER DEFAULT 1,
ALTER COLUMN "minOrderAmount" SET DEFAULT 0,
ALTER COLUMN "validTo" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "aggregator" TEXT,
ADD COLUMN     "cashCollectAmount" DECIMAL(65,30) DEFAULT 0,
ADD COLUMN     "cod" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "codCharge" DECIMAL(65,30) DEFAULT 0,
ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerFullName" TEXT,
ADD COLUMN     "customerMobileNumber" TEXT,
ADD COLUMN     "deliveryFee" DECIMAL(65,30) DEFAULT 0,
ADD COLUMN     "deliveryPriority" TEXT DEFAULT 'now',
ADD COLUMN     "dropAddress" TEXT,
ADD COLUMN     "itemDetails" TEXT,
ADD COLUMN     "itemValue" DECIMAL(65,30),
ADD COLUMN     "lastLogisticsSync" TIMESTAMP(3),
ADD COLUMN     "merchantPickupAddressId" TEXT,
ADD COLUMN     "orderCode" TEXT,
ADD COLUMN     "otp" TEXT,
ADD COLUMN     "rcvPay" BOOLEAN DEFAULT true,
ADD COLUMN     "receiverDistrict" TEXT,
ADD COLUMN     "receiverDivision" TEXT,
ADD COLUMN     "receiverThana" TEXT,
ADD COLUMN     "requestDeliveryDate" TEXT,
ADD COLUMN     "tax" DECIMAL(65,30) DEFAULT 0,
ADD COLUMN     "vat" DECIMAL(65,30) DEFAULT 0;

-- CreateTable
CREATE TABLE "CouponCollection" (
    "couponId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,

    CONSTRAINT "CouponCollection_pkey" PRIMARY KEY ("couponId","collectionId")
);

-- CreateTable
CREATE TABLE "Division" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "pathaoId" TEXT,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Thana" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "pathaoId" TEXT,
    "rdxId" TEXT,
    "zipCode" TEXT,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Thana_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thanaId" TEXT NOT NULL,
    "rdxId" TEXT,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupAddress" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "thana" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "senderFullName" TEXT,
    "senderAddress" TEXT,
    "senderUnitOrFloor" TEXT,
    "senderPhoneNumber" TEXT,
    "pickupNote" TEXT,
    "senderThanaId" TEXT,
    "senderRdxId" TEXT,
    "pathaoCityId" TEXT,
    "pathaoZoneId" TEXT,
    "pathaoStoreId" TEXT,
    "redxStoreId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Division_externalId_key" ON "Division"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "District_externalId_key" ON "District"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Thana_externalId_key" ON "Thana"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Area_externalId_key" ON "Area"("externalId");

-- AddForeignKey
ALTER TABLE "CouponCollection" ADD CONSTRAINT "CouponCollection_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCollection" ADD CONSTRAINT "CouponCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thana" ADD CONSTRAINT "Thana_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_thanaId_fkey" FOREIGN KEY ("thanaId") REFERENCES "Thana"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
