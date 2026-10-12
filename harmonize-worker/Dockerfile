# Build from the repository root:
#   docker build -f harmonize-worker/Dockerfile .
# Pass GEMINI_API_KEY, VIBODE_APP_BASE_URL, and
# VIBODE_HARMONIZE_WORKER_SECRET at runtime. Do not copy environment files.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY lib ./lib
COPY app ./app
COPY harmonize-worker ./harmonize-worker
CMD ["npm", "run", "harmonize:worker"]
