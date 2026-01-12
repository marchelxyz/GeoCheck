FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY prisma ./prisma
COPY server/ ./
RUN npx prisma generate

FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install
COPY prisma ./prisma
RUN cd server && npx prisma generate
RUN cd server && npm prune --production
COPY server ./server
COPY --from=client-builder /app/client/dist ./client/dist
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "index.js"]
