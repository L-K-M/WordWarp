FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN npm run build

FROM nginx:1.31.5-alpine-slim@sha256:3b171d7224b669faa3cc2137fea0a65301791df1ec1f271ebd2a2b7461f7fade AS base

FROM base AS runtime

# Notices for the base image's Alpine packages (BusyBox, musl, OpenSSL, nginx and
# the rest): licenses, exact source versions and license texts, read from the
# package database. Fetches canonical SPDX texts and upstream license files, and
# fails when a package has no license text.
RUN --mount=type=bind,source=scripts/os-packages.sh,target=/tmp/os-packages.sh \
    --mount=type=bind,source=scripts/os-packages-overrides.txt,target=/tmp/os-packages-overrides.txt \
    --mount=type=bind,from=base,source=/lib/apk/db/installed,target=/tmp/base-db \
    --mount=type=cache,target=/var/cache/os-packages,sharing=locked \
    sh /tmp/os-packages.sh --image wordwarp --base-db /tmp/base-db \
      --overrides /tmp/os-packages-overrides.txt --cache /var/cache/os-packages \
      /usr/share/doc/wordwarp/OS-Packages.txt
COPY LICENSE /usr/share/doc/wordwarp/LICENSE
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "--quiet", "--output-document=/dev/null", "http://127.0.0.1/"]
