/*
  Warnings:

  - The values [MALE,FEMALE] on the enum `GenderType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `bannerImage` on the `Collection` table. All the data in the column will be lost.
  - You are about to drop the column `displayOrder` on the `Collection` table. All the data in the column will be lost.
  - You are about to drop the column `imageUrl` on the `Collection` table. All the data in the column will be lost.
  - You are about to drop the column `isBanner` on the `Collection` table. All the data in the column will be lost.
  - You are about to drop the column `gender` on the `CollectionPlacement` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CollectionPlacement" DROP COLUMN "gender";

-- AlterEnum
BEGIN;
CREATE TYPE "GenderType_new" AS ENUM ('MEN', 'WOMEN', 'KIDS');
ALTER TABLE "Category" ALTER COLUMN "gender" TYPE "GenderType_new"[] USING ("gender"::text::"GenderType_new"[]);
ALTER TABLE "Collection" ALTER COLUMN "gender" TYPE "GenderType_new"[] USING ("gender"::text::"GenderType_new"[]);
ALTER TABLE "Product" ALTER COLUMN "gender" TYPE "GenderType_new"[] USING ("gender"::text::"GenderType_new"[]);
ALTER TYPE "GenderType" RENAME TO "GenderType_old";
ALTER TYPE "GenderType_new" RENAME TO "GenderType";
DROP TYPE "public"."GenderType_old";
COMMIT;

-- AlterTable
ALTER TABLE "Collection" DROP COLUMN "bannerImage",
DROP COLUMN "displayOrder",
DROP COLUMN "imageUrl",
DROP COLUMN "isBanner";

-- AlterTable
ALTER TABLE "CollectionPlacement" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isBanner" BOOLEAN NOT NULL DEFAULT false;
