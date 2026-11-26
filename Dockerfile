FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "start"]
