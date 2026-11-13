# Backend image: `dev` target keeps dev deps for docker-compose.yml (nodemon);
# `prod` target is the production runtime used by docker-compose.staging.yml.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM prod-deps AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
EXPOSE 3001
CMD ["npm", "start"]

FROM deps AS dev
ENV NODE_ENV=development
COPY src ./src
CMD ["npm", "run", "dev"]
