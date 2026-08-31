FROM node:22-alpine AS webbuild
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY --from=webbuild /app/web/dist ./web/dist
# Create non-root user (enterprise security) and ensure data dir writable
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    mkdir -p server/data/uploads && chown -R appuser:appgroup /app
USER appuser
ENV NODE_ENV=production
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4000/api/health | grep -q '"ok":true' || exit 1
CMD ["node","server/index.js"]
