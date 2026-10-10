FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY introspection-server.mjs tools.json ./
CMD ["node", "introspection-server.mjs"]
