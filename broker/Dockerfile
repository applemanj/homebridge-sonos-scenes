FROM node:22-alpine
WORKDIR /app
COPY package.json .
COPY src/ src/
EXPOSE 8787
VOLUME /app/data
ENV BROKER_PORT=8787 BROKER_HOST=0.0.0.0
CMD ["node", "src/server.mjs"]
