FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY introspection-server.mjs ./
CMD ["node", "introspection-server.mjs"]
