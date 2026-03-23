# Client Dockerfile - nginx-based
FROM node:20-alpine AS builder

WORKDIR /app

# Copy and install
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
ENV VITE_API_URL=https://server-production-353d.up.railway.app/api
RUN npm run build

# Production with nginx
FROM nginx:alpine

# Simple nginx config for SPA
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# Use ENTRYPOINT to prevent Railway from overriding the start command
ENTRYPOINT ["nginx", "-g", "daemon off;"]
