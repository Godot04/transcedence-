FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN npm install

COPY *.js ./

EXPOSE 3000

CMD ["sh", "-c", "npm run prisma:push && npm start"]