# Public-facing ingress only; nextcrm-web itself must NOT have a public domain.
# Pin base image by digest before publishing a real production release.
FROM caddy:2.10.2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 8080
