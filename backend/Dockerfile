# --- deps + build stage ---
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY backend ./backend

RUN pnpm install --frozen-lockfile --filter @wolf1276/kairos-agent-backend... --filter @wolf1276/kairos-sdk...

WORKDIR /repo/backend
RUN pnpm build

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/backend ./backend

WORKDIR /app/backend
RUN mkdir -p /app/backend/data
VOLUME ["/app/backend/data"]

EXPOSE 4001
CMD ["node", "dist/index.js"]
