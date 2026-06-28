FROM node:20.19-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi && npm cache clean --force

COPY . .

RUN npm run build

ENV NODE_ENV=production

CMD ["npm", "run", "docker-start"]
