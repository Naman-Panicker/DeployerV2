FROM node:22-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY proto/ ./proto/
COPY services/upload-service/ ./services/upload-service/

RUN npm install
RUN npm run build --workspace=@deployer/config --workspace=@deployer/proto

EXPOSE 9002

CMD ["npm", "run", "start", "--workspace=@deployer/upload-service"]
