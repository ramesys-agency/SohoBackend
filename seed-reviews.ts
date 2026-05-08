import { PrismaService } from "./src/core/services/prisma.service.js";
import 'dotenv/config';

async function main() {
    const prismaService = new PrismaService();
    await prismaService.connect();
    const prisma = prismaService.getClient();

    const products = await prisma.product.findMany({ take: 3 });
    const users = await prisma.user.findMany({ take: 2 });
    
    if (products.length === 0 || users.length === 0) {
        console.log("Not enough products or users to seed reviews.");
        return;
    }

    const reviewsData = [
        {
            rating: 5,
            comment: "This is a beautiful Spring floral dress for your Spring look. Its elegance makes you ready for any occasion with subtle neckline.",
        },
        {
            rating: 4,
            comment: "Great quality but a bit tight around the shoulders.",
        },
        {
            rating: 5,
            comment: "Absolutely love it! Highly recommended.",
        }
    ];

    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        
        // Create 1-2 reviews for each product
        for (let j = 0; j <= i % 2; j++) {
            const user = users[j % users.length];
            const reviewText = reviewsData[(i + j) % reviewsData.length];
            
            await prisma.review.create({
                data: {
                    productId: product.id,
                    userId: user.id,
                    rating: reviewText.rating,
                    comment: reviewText.comment,
                    images: j === 0 && i === 0 ? ["https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=200&auto=format&fit=crop"] : [],
                }
            });
            console.log(`Created review for product: ${product.name} by user: ${user.fullName}`);
        }
        
        // Update product overallRating and reviewCount
        const allReviews = await prisma.review.findMany({ where: { productId: product.id } });
        const totalRating = allReviews.reduce((sum, r) => Number(sum) + Number(r.rating), 0);
        const avgRating = allReviews.length > 0 ? totalRating / allReviews.length : 0;
        
        await prisma.product.update({
            where: { id: product.id },
            data: {
                overallRating: avgRating,
                reviewCount: allReviews.length
            }
        });
    }
    
    console.log("Successfully seeded reviews!");
    await prismaService.disconnect();
}

main().catch(console.error);
