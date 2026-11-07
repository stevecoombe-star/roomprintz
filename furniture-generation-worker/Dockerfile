# Build from the repository root:
#   docker build -f furniture-generation-worker/Dockerfile .
#
# One Railway service for furniture generation. Keep it separate from the
# Next.js app, Harmonize, Clean Up, and the thumbnail worker.
#
# Railway:
#   Root directory / build context: repository root
#   Dockerfile path: furniture-generation-worker/Dockerfile
#   Start command: node --conditions=react-server --import tsx furniture-generation-worker/src/index.ts
#   Public networking: off
#   Healthcheck path: empty
#
# The image command is this worker. It does not start the Next.js server.
# The process does not listen on a port, so a platform healthcheck must stay empty.
#
# Disabled installation needs only runtime Supabase credentials:
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
# Provider stays fake, processing stays off, and generation stays off.
# Do not set MESHY_API_KEY. Do not set the provider to meshy, do not set
# either generation switch to true, and do not grant a paid submission
# while installing the service. A key added later does not select real mode.
#
# Processing runs only when VIBODE_FURNITURE_GENERATION_WORKER_ENABLED is
# exactly "true". Real mode also requires the provider to be exactly
# "meshy", VIBODE_MESHY_GENERATION_ENABLED to be exactly "true", and
# MESHY_API_KEY at runtime. Pass those only in a later, separate approval.
#
# tsx is a devDependency and this process runs TypeScript, matching the
# other workers. Install the lockfile before NODE_ENV=production so the
# runner is present. Do not copy environment files into the image.
#
# SIGTERM stops the loop after the current pass. Node is the container
# process so that signal reaches the worker.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY lib ./lib
COPY furniture-generation-worker ./furniture-generation-worker
ENV NODE_ENV=production
ENV VIBODE_FURNITURE_GENERATION_PROVIDER=fake
ENV VIBODE_FURNITURE_GENERATION_WORKER_ENABLED=false
ENV VIBODE_MESHY_GENERATION_ENABLED=false
CMD ["node", "--conditions=react-server", "--import", "tsx", "furniture-generation-worker/src/index.ts"]
