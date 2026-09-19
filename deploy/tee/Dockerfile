FROM node:22.23.0-bookworm-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src/integration ./src/integration
COPY src/shared/protocol.js ./src/shared/protocol.js
COPY contracts/integration ./contracts/integration
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "src/integration/tee-server.js"]
