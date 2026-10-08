FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache docker-cli


COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY services/build-server/ ./services/build-server/

RUN npm install
RUN npm run prisma:generate
RUN npm run build --workspace=@deployer/config --workspace=@deployer/crypto --workspace=@deployer/queue --workspace=@deployer/prisma

CMD ["npm", "run", "start", "--workspace=@deployer/build-server"]
