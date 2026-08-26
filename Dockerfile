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
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node","server/index.js"]
