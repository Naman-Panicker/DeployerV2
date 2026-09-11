FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache docker-cli


COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY proto/ ./proto/
COPY services/build-server/ ./services/build-server/

RUN npm install
RUN npm run prisma:generate
RUN npm run build --workspace=@deployer/config --workspace=@deployer/proto --workspace=@deployer/prisma

EXPOSE 9001

CMD ["npm", "run", "start", "--workspace=@deployer/build-server"]
