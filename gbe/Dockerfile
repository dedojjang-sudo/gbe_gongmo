FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
RUN npm install --omit=dev

COPY schema.js db.js cap.js views.js pages.js server.js ./

EXPOSE 3000

CMD ["node", "server.js"]
