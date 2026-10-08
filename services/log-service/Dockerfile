FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY services/log-service/ ./services/log-service/

RUN npm install
RUN npm run prisma:generate
RUN npm run build --workspace=@deployer/config --workspace=@deployer/prisma

EXPOSE 9003

CMD ["npm", "run", "start", "--workspace=@deployer/log-service"]
