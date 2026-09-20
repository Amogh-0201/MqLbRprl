FROM node:24-alpine

WORKDIR /app

# Copy package files first
COPY package*.json ./

RUN npm ci --omit=dev

# Copy application source
COPY . .

EXPOSE 3000

CMD ["node", "app.js"]