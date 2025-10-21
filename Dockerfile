# Stage 1: Dependencies
FROM node:25.0.0-alpine AS dependencies

WORKDIR /app

# Copiar arquivos de configuração de dependências
COPY package.json yarn.lock ./

# Instalar dependências
RUN yarn install --frozen-lockfile && yarn cache clean

# Stage 2: Runtime
FROM node:25.0.0-alpine

WORKDIR /app

# Copiar node_modules do stage de dependencies
COPY --from=dependencies /app/node_modules ./node_modules

# Copiar código fonte
COPY package.json ./
COPY bin ./bin
COPY lib ./lib
COPY localtunnel.js ./

# Definir entrypoint e comando padrão
ENTRYPOINT ["node", "bin/lt.js"]
CMD ["--help"]
