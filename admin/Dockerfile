FROM node:24-bookworm-slim
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates lib32gcc-s1 && \
    rm -rf /var/lib/apt/lists/* && mkdir -p /opt/steamcmd && \
    curl -fSL --retry 3 https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar -xz -C /opt/steamcmd
# This dependency-free service only needs Node; package managers add unused attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY *.mjs ./
COPY public ./public
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
