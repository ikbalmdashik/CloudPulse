# syntax=docker/dockerfile:1

# ---- deps: every dependency, for building and for running migrations ----
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compiles TypeScript to dist/ ----
# Also the image the compose `migrate` service runs: it has the Prisma CLI,
# the migrations and the compiled seed script.
FROM deps AS build
COPY . .
RUN npm run build

# ---- runtime: production dependencies and dist/ only ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
# Answers 200 without a login; used by the compose healthcheck.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/auth/accounts').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
