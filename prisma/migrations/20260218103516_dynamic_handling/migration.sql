/*
  Warnings:

  - You are about to drop the column `basePrice` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `originalPrice` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `priceDiff` on the `ProductVariant` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,variantId]` on the table `Wishlist` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `basePrice` to the `ProductVariant` table without a default value. This is not possible if the table is not empty.
  - Added the required column `variantId` to the `Wishlist` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Wishlist" DROP CONSTRAINT "Wishlist_productId_fkey";

-- DropIndex
DROP INDEX "Wishlist_userId_productId_key";

-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "basePrice",
DROP COLUMN "originalPrice";

-- AlterTable
ALTER TABLE "ProductCollection" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductVariant" DROP COLUMN "priceDiff",
ADD COLUMN     "basePrice" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalPrice" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "Wishlist" ADD COLUMN     "variantId" TEXT NOT NULL,
ALTER COLUMN "productId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Wishlist_userId_variantId_key" ON "Wishlist"("userId", "variantId");

-- AddForeignKey
ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
