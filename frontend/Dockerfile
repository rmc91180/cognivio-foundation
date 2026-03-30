FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY patches ./patches
RUN npm ci --legacy-peer-deps

COPY . .

RUN npm run build
RUN chmod +x /app/scripts/start-frontend.sh

CMD ["sh", "/app/scripts/start-frontend.sh"]
