# Build from the repository root:
#   docker build -f harmonize-worker/Dockerfile .
#
# One dedicated Harmonize service. Keep it separate from the thumbnail worker.
# Start with one replica when processing is enabled. The image command has
# no job id and does not contact a provider by itself.
#
# Processing stays off unless VIBODE_HARMONIZE_WORKER_ENABLED=1.
# Pass that flag, GEMINI_API_KEY, VIBODE_APP_BASE_URL, and
# VIBODE_HARMONIZE_WORKER_SECRET at runtime. Do not copy environment files.
# PORT defaults to 8080. Railway should probe GET /health. GET /ready is
# process readiness and also returns 200 while processing is disabled.
# Neither response authorizes a provider contact. A disabled worker still
# returns 200 so the platform does not restart it.
#
# SIGTERM does not abort an in-flight provider call. The stop timeout should
# be at least 240 seconds so that call, its heartbeat, and publication can
# finish before the process is killed. Node is the container process so that
# signal reaches the worker; npm would swallow it.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY lib ./lib
COPY app ./app
COPY harmonize-worker ./harmonize-worker
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "harmonize-worker/src/index.ts"]
