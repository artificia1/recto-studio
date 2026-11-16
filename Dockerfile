FROM node:24-bookworm-slim
WORKDIR /opt/recto
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY bin ./bin
USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/recto/bin/recto.js"]
CMD ["--help"]
