# Build from the repository root:
#   docker build -f cleanup-worker/Dockerfile .
#
# One dedicated Clean Up service. Do not reuse the Harmonize service or the
# thumbnail worker. The command has no job id and does not contact a provider
# by itself.
#
# Processing stays off unless VIBODE_CLEANUP_WORKER_ENABLED=1. The image sets
# that variable to 0. A runtime value of exactly 1 overrides it. Pass
# GEMINI_API_KEY and SUPABASE_SERVICE_ROLE_KEY at runtime. Do not copy
# environment files into the image.
#
# The worker loads server modules, including the server-only marker pulled in
# by history acceptance, so Node must use the react-server condition.
# PORT defaults to 8080. Probe GET /health. GET /ready is process readiness
# and also returns 200 while processing is disabled. Neither response
# authorizes a provider contact.
#
# SIGTERM asks the loop to stop after the current pass. It does not abort an
# in-flight provider call. Node is the container process so that signal
# reaches the worker.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY lib ./lib
COPY app ./app
COPY cleanup-worker ./cleanup-worker
ENV NODE_ENV=production
ENV PORT=8080
ENV VIBODE_CLEANUP_WORKER_ENABLED=0
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--conditions=react-server", "--import", "tsx", "cleanup-worker/src/index.ts", "--provider", "google"]
