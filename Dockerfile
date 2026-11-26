FROM node:22-bookworm-slim

# Instalar PostgreSQL 17 client (pg_dump compatível com Supabase PostgreSQL 17.6)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    ca-certificates \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Variáveis públicas do Next.js necessárias no momento do build
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_ASAAS_ENV
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SUPABASE_GLASS_ANON_KEY
ARG NEXT_PUBLIC_SUPABASE_GLASS_URL
ARG NEXT_PUBLIC_SUPABASE_URL

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
