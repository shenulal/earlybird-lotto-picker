# Pickora — one container per event (tenant).
#
# The image holds the application only. Each tenant's settings, entry list,
# draw state and uploads live in the volume mounted at /data, so the same image
# serves any number of events side by side, each from its own volume.
#
#   docker build -t pickora .
#   docker run -d -p 3000:3000 -v pickora-alpha:/data \
#     -e PICKORA_TENANT=alpha -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='…' pickora

FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    PICKORA_DATA_DIR=/data \
    PICKORA_REQUIRE_ADMIN_CREDENTIALS=1

WORKDIR /app

# No dependencies to install: the HTTP layer is built on Node's own modules.
# Owned by root, so the server cannot rewrite its own code — the only place it
# can write is the tenant's /data volume.
COPY . .

RUN mkdir -p /data && chown node:node /data

USER node

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server.js"]
