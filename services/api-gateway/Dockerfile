FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY services/api-gateway/ ./services/api-gateway/

RUN npm install
RUN npm run prisma:generate
RUN npm run build --workspace=@deployer/config --workspace=@deployer/crypto --workspace=@deployer/queue --workspace=@deployer/prisma

EXPOSE 9000

CMD ["npm", "run", "start", "--workspace=@deployer/api-gateway"]
