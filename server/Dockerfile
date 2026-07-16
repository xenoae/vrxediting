FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates curl && \
    pip3 install --break-system-packages -U yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm ls cors express
COPY . .

ENV PORT=8787
EXPOSE 8787
CMD ["node", "index.js"]
