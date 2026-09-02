FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY proto/ ./proto/
COPY services/api-gateway/ ./services/api-gateway/

RUN npm install

EXPOSE 9000

CMD ["npm", "run", "start", "--workspace=@deployer/api-gateway"]
