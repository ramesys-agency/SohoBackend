# 1. Use Node base image
FROM node:20-slim

# 2. Install Tailscale & Dependencies
RUN apt-get update && apt-get install -y curl ca-certificates iptables && \
    curl -fsSL https://tailscale.com/install.sh | sh && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. Install App Dependencies
COPY package*.json ./
# Skip husky in Docker
RUN npm install --ignore-scripts 

# 4. Copy Code & Build (Omit prisma generate here)
COPY . .
RUN npm run build

# 5. Create Startup Script
# We generate the prisma client HERE, where DATABASE_URL is available
RUN echo '#!/bin/sh\n\
    tailscaled --tun=userspace-networking --socks5-server=localhost:1055 & \n\
    sleep 2 \n\
    tailscale up --authkey=${TAILSCALE_AUTH_KEY} --hostname=soho-backend \n\
    # Generate prisma client at runtime\n\
    npx prisma generate --config prisma/prisma.config.ts \n\
    node dist/server.js' > /app/start.sh && chmod +x /app/start.sh

# 6. Execute
CMD ["/app/start.sh"]
