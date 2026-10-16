# Luxcores backend image. Build from the REPO ROOT, because the server runs the
# repo's simulation and serves the web client:
#
#   docker build -f backend/nodejs/Dockerfile -t luxcores-backend .
#
# Stage 1 compiles the TypeScript. Stage 2 holds only production dependencies,
# the compiled app, and the game folders the server reads at run time.

FROM node:22-alpine AS build
WORKDIR /app/backend
COPY backend/nodejs/package.json backend/nodejs/package-lock.json ./
RUN npm ci
COPY backend/nodejs/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    LUXCORES_ROOT=/app/game \
    PUBLIC_DIR=/app/backend/public
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/public ./public

# What the server loads and serves: the sim and the web client (src), the game data, the models and the page.
COPY index.html /app/game/index.html
COPY src /app/game/src
COPY data /app/game/data
COPY assets /app/game/assets
# COPY keeps the file modes of the checkout, and a developer machine may use 700. The app runs as the unprivileged node user, so make the files readable.
RUN chmod -R a+rX /app/game

# The JSON database driver writes here. Production uses PostgreSQL instead.
RUN mkdir -p /app/backend/data && chown node:node /app/backend/data
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/main.js"]
