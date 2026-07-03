# --- deps + build stage ---
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile --filter app... --filter @wolf1276/kairos-sdk...

WORKDIR /repo/apps/web
ARG NEXT_PUBLIC_AGENTS_BACKEND_URL
ENV NEXT_PUBLIC_AGENTS_BACKEND_URL=$NEXT_PUBLIC_AGENTS_BACKEND_URL
RUN pnpm build

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
