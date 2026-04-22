# Build stage
FROM node:22.13.0-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY prisma ./prisma/
RUN npx prisma generate --config prisma/prisma.config.ts

COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# Production stage
FROM node:22.13.0-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/src/generated ./src/generated/
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/prisma ./prisma/

RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

CMD ["node", "dist/server.js"]
