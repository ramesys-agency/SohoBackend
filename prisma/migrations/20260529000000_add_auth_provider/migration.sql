-- AlterTable: add authProvider and authProviderId to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authProvider" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authProviderId" TEXT;

-- CreateIndex: unique constraint on authProviderId
CREATE UNIQUE INDEX IF NOT EXISTS "User_authProviderId_key" ON "User"("authProviderId");

-- CreateIndex: unique constraint on Review(productId, userId)
CREATE UNIQUE INDEX IF NOT EXISTS "Review_productId_userId_key" ON "Review"("productId", "userId");

-- CreateTable: CollectionPlacementProduct
CREATE TABLE IF NOT EXISTS "CollectionPlacementProduct" (
    "placementId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionPlacementProduct_pkey" PRIMARY KEY ("placementId","productId")
);

-- AddForeignKey
ALTER TABLE "CollectionPlacementProduct" ADD CONSTRAINT "CollectionPlacementProduct_placementId_fkey"
    FOREIGN KEY ("placementId") REFERENCES "CollectionPlacement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CollectionPlacementProduct" ADD CONSTRAINT "CollectionPlacementProduct_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
