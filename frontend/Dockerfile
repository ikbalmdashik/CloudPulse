# syntax=docker/dockerfile:1

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
# Both URLs are fixed at build time: Next.js compiles the /api rewrite target
# into the build, and NEXT_PUBLIC_* values into the browser bundle.
FROM deps AS build
# Where the Next.js server forwards /api/* (container to container).
ARG BACKEND_URL=http://backend:4000
# Where the browser opens its WebSocket (from the user's machine).
ARG NEXT_PUBLIC_REALTIME_URL=http://localhost:4000
ENV BACKEND_URL=$BACKEND_URL \
    NEXT_PUBLIC_REALTIME_URL=$NEXT_PUBLIC_REALTIME_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# ---- runtime: Next.js standalone server ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
