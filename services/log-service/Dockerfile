FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY proto/ ./proto/
COPY services/log-service/ ./services/log-service/

RUN npm install

EXPOSE 9003

CMD ["npm", "run", "start", "--workspace=@deployer/log-service"]
