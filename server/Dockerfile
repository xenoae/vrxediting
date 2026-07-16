FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates curl unzip && \
    pip3 install --break-system-packages -U "yt-dlp[default]" yt-dlp-ejs && \
    curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PATH="/usr/local/bin:${PATH}"

WORKDIR /app
COPY . .
RUN rm -rf node_modules && npm install --omit=dev && npm ls cors express

ENV PORT=8787
EXPOSE 8787
CMD ["node", "index.js"]