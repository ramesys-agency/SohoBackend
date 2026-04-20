# --- Builder Stage ---
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm install

# Copy source and prisma
COPY . .

# Generate Prisma Client
RUN npx prisma generate --config prisma/prisma.config.ts

# Build TypeScript
RUN npm run build:prod

# --- Production Stage ---
FROM node:20-slim AS production

WORKDIR /app

# 1. Install runtime dependencies only
RUN apt-get update && apt-get install -y curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# 2. Copy production dependencies
COPY package*.json ./
RUN npm install --only=production --ignore-scripts

# 3. Copy build artifacts and prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# 4. Standard Environment Variables
ENV NODE_ENV="production"
ENV PORT=3000

# 5. Startup behavior
# We keep a simple script to trigger the seed on startup if you still want it 
# Otherwise, you can change this to simply: CMD ["node", "dist/server.js"]
RUN echo "#!/bin/sh\n\
    npm run db:seed\n\
    node dist/server.js" > /app/start.sh && chmod +x /app/start.sh

EXPOSE 3000

CMD ["/app/start.sh"]
