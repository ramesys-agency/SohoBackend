# --- Build Stage ---
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm install

# Copy source and generate prisma client
COPY . .
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate --config prisma/prisma.config.ts

# Build the project
RUN npx tsc -p tsconfig.build.json

# --- Production Stage ---
FROM node:20-slim AS production

# 1. Install Tailscale, socat & runtime dependencies
RUN apt-get update && apt-get install -y curl ca-certificates iptables socat && \
    curl -fsSL https://tailscale.com/install.sh | sh && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 2. Copy dependencies and build artifacts
COPY package*.json ./
RUN npm install --only=production --ignore-scripts
# Install tsx globally or locally in prod to handle the seed
RUN npm install tsx

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/tsconfig.build.json ./

# 3. Dummy env vars for runtime generation/seeding
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV JWT_SECRET="placeholder_secret_for_seed_that_is_at_least_32_characters"
ENV BUCKET_NAME="placeholder_bucket"
ENV ACCESS_KEY="placeholder_key"
ENV SECRET_KEY="placeholder_secret"
ENV REGION="us-east-1"

# 4. Create Startup Script
RUN echo "#!/bin/sh\n\
tailscaled --tun=userspace-networking --socks5-server=localhost:1055 & \n\
sleep 3 \n\
tailscale up --authkey=\${TAILSCALE_AUTH_KEY} --hostname=soho-backend \n\
\n\
# Map Local Ports to Remote Tailscale IPs via Proxy\n\
# We use 127.0.0.1 to avoid IPv6 resolution issues\n\
socat TCP4-LISTEN:5432,fork SOCKS4A:127.0.0.1:\${SERVER_IP}:5432,socksport=1055 & \n\
socat TCP4-LISTEN:6379,fork SOCKS4A:127.0.0.1:\${SERVER_IP}:6379,socksport=1055 & \n\
socat TCP4-LISTEN:9000,fork SOCKS4A:127.0.0.1:\${SERVER_IP}:9000,socksport=1055 & \n\
\n\
# Sync DB client and run non-destructive seed\n\
npx prisma generate --config prisma/prisma.config.ts \n\
npm run db:seed \n\
\n\
node dist/server.js" > /app/start.sh && chmod +x /app/start.sh

CMD ["/app/start.sh"]
