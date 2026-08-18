FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json .node-version ./
COPY operator/package.json operator/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci --workspace=@yield-vault/operator --include-workspace-root

COPY operator/tsconfig.json operator/tsconfig.json
COPY operator/src operator/src

RUN npm run build -w @yield-vault/operator

ENV NODE_ENV=production

CMD ["npm", "run", "start", "-w", "@yield-vault/operator"]
