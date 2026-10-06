# Node 24 because the server uses node:sqlite, which is only unflagged from
# 23.4. Debian slim rather than alpine: every dependency here is pure
# JavaScript, so there is nothing to gain from musl and one less thing to
# debug if that ever stops being true.
FROM node:24-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Also copies public/ into dist/, so the self-hosted fonts ship with the app.
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

# Only what the server needs to run: no Vite, no React, no build toolchain.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server

# Fly sets PORT; this is the default the config below also uses.
ENV PORT=8080
EXPOSE 8080

# Not `npm start` - that wrapper exists to load .env for local runs, and in a
# container the real environment variables are already present.
CMD ["node", "server/index.js"]
