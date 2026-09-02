FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY proto/ ./proto/
COPY services/upload-service/ ./services/upload-service/

RUN npm install

EXPOSE 9002

CMD ["npm", "run", "start", "--workspace=@deployer/upload-service"]
