FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY prisma ./prisma
COPY server/ ./
RUN npx prisma generate

FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --only=production
COPY prisma ./prisma
RUN npx prisma generate
COPY server ./server
COPY --from=client-builder /app/client/dist ./client/dist
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "index.js"]
