# Worker image (Railway builds this automatically from the repo root).
# The web panel runs on Vercel and is not part of this image.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first, so code changes reuse this layer.
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/services/package.json packages/services/
RUN npm ci --omit=dev --workspace @post-lead/worker --include-workspace-root=false \
  && npm cache clean --force

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

# Applies pending migrations, then starts the long-running worker.
CMD ["npm", "run", "start:deploy", "--workspace", "@post-lead/worker"]
