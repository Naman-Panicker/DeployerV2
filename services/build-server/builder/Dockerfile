FROM node:20-alpine

# Install git, curl, ca-certificates, bash
RUN apk add --no-cache git curl ca-certificates bash

# Setup /scripts and dependencies
WORKDIR /scripts
RUN npm init -y && npm install mime-types@^2.1.35

COPY logger.mjs /scripts/logger.mjs
COPY detect.mjs /scripts/detect.mjs
COPY upload.mjs /scripts/upload.mjs
COPY entrypoint.sh /scripts/entrypoint.sh

RUN chmod +x /scripts/entrypoint.sh

WORKDIR /app

ENTRYPOINT ["/bin/sh", "/scripts/entrypoint.sh"]
