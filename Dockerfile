# ---- Build stage ----
# Use full node image (not slim) for native addon compilation (better-sqlite3)
FROM node:22 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ---- Runtime stage ----
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ ./dist/

ENV PORT=3456
EXPOSE 3456

VOLUME /app/data

CMD ["node", "dist/server.js"]
