FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY proto/ ./proto/
COPY services/reverse-proxy/ ./services/reverse-proxy/

RUN npm install

EXPOSE 8080

CMD ["npm", "run", "start", "--workspace=@deployer/reverse-proxy"]
