-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('HOME', 'MEN', 'WOMEN', 'KIDS', 'CATALOG', 'OFFER');

-- CreateEnum
CREATE TYPE "SectionType" AS ENUM ('TOP_BANNER', 'MID_BANNER', 'FEATURED_ROW', 'GRID_SECTION', 'SEE_ALL');

-- CreateEnum
CREATE TYPE "GenderType" AS ENUM ('MALE', 'FEMALE', 'KIDS');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "gender" "GenderType"[];

-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "bannerImage" TEXT,
ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gender" "GenderType"[],
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isBanner" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "gender" "GenderType"[];

-- CreateTable
CREATE TABLE "CollectionPlacement" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "page" "PageType" NOT NULL,
    "section" "SectionType",
    "gender" "GenderType",
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionPlacement_page_section_idx" ON "CollectionPlacement"("page", "section");

-- AddForeignKey
ALTER TABLE "CollectionPlacement" ADD CONSTRAINT "CollectionPlacement_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
