# BUILD THE SERVER IMAGE
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    unzip \
    procps \
    lib32gcc-s1 \
    libicu-dev \
    python3 \
    gosu \
    tini \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Platform-specific release includes the .NET runtime.
ARG DEPOT_DOWNLOADER_VERSION=3.4.0
RUN curl -fSL --retry 3 "https://github.com/SteamRE/DepotDownloader/releases/download/DepotDownloader_${DEPOT_DOWNLOADER_VERSION}/DepotDownloader-linux-x64.zip" -o /tmp/dd.zip && \
    mkdir -p /depotdownloader && \
    unzip /tmp/dd.zip -d /depotdownloader && \
    chmod +x /depotdownloader/DepotDownloader && \
    rm /tmp/dd.zip

RUN mkdir -p /opt/steamcmd && \
    curl -fSL --retry 3 https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar -xz -C /opt/steamcmd

RUN useradd -m -s /bin/bash steam

LABEL maintainer="support@indifferentbroccoli.com" \
      name="indifferentbroccoli/runescape-dragonwilds-server-docker" \
      github="https://github.com/indifferentbroccoli/runescape-dragonwilds-server-docker" \
      dockerhub="https://hub.docker.com/r/indifferentbroccoli/runescape-dragonwilds-server-docker"

ENV HOME=/home/steam \
    DEFAULT_PORT=7777 \
    SERVER_NAME="DragonWildsServer" \
    DEFAULT_WORLD_NAME="MyWorld" \
    OWNER_ID="" \
    MAX_PLAYERS=6 \
    MULTIHOME="" \
    UPDATE_ON_START=true \
    PUID=1000 \
    PGID=1000

COPY ./scripts /home/steam/server/

COPY branding /branding

RUN mkdir -p /home/steam/server-files /backups && \
    sed -i 's/\r$//' /home/steam/server/*.sh && \
    chmod +x /home/steam/server/*.sh && \
    /depotdownloader/DepotDownloader --version

WORKDIR /home/steam/server

HEALTHCHECK --start-period=15m --interval=30s --timeout=5s --retries=3 \
    CMD python3 /home/steam/server/healthcheck.py

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/home/steam/server/init.sh"]
