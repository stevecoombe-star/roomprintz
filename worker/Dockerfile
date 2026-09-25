FROM mcr.microsoft.com/playwright:v1.55.1-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json \
  && npm prune --omit=dev \
  && rm -rf src tsconfig.json

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "dist/index.js"]
