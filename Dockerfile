# 1. Use Node base image
FROM node:20-slim

# 2. Install Tailscale & Dependencies
RUN apt-get update && apt-get install -y curl ca-certificates iptables && \
    curl -fsSL https://tailscale.com/install.sh | sh && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. Install App Dependencies
COPY package*.json ./
RUN npm install

# 4. Copy Code & Build
COPY . .
RUN npx prisma generate
RUN npm run build

# 5. Create Startup Script
# This script starts Tailscale first, then your app
RUN echo '#!/bin/sh\n\
    tailscaled --tun=userspace-networking --socks5-server=localhost:1055 & \n\
    tailscale up --authkey=${TAILSCALE_AUTH_KEY} --hostname=soho-backend \n\
    npm run start' > /app/start.sh && chmod +x /app/start.sh

# 6. Execute
CMD ["/app/start.sh"]
