FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY proto/ ./proto/
COPY services/build-server/ ./services/build-server/

RUN npm install

EXPOSE 9001

CMD ["npm", "run", "start", "--workspace=@deployer/build-server"]
