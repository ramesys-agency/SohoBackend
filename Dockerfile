# 1. Use Node base image
FROM node:20-slim

# 2. Install Tailscale & Dependencies
RUN apt-get update && apt-get install -y curl ca-certificates iptables && \
    curl -fsSL https://tailscale.com/install.sh | sh && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. Install App Dependencies
COPY package*.json ./
RUN npm install --ignore-scripts

# 4. Copy Code
COPY . .

# 5. Generate Prisma Client (Using a DUMMY DATABASE_URL for build time)
# This allows TypeScript to find the types and compile successfully
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate --config prisma/prisma.config.ts

# 6. Build the project
RUN npm run build

# 7. Create Startup Script
RUN echo '#!/bin/sh\n\
    tailscaled --tun=userspace-networking --socks5-server=localhost:1055 & \n\
    sleep 2 \n\
    tailscale up --authkey=${TAILSCALE_AUTH_KEY} --hostname=soho-backend \n\
    # We run generate again at runtime to ensure the client is synced with the REAL DB\n\
    npx prisma generate --config prisma/prisma.config.ts \n\
    node dist/server.js' > /app/start.sh && chmod +x /app/start.sh

# 8. Execute
CMD ["/app/start.sh"]
