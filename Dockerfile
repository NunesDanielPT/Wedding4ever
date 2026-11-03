FROM oven/bun:1.4-slim
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN mkdir -p /data && chown bun:bun /data
USER bun
ENV NODE_ENV=production STORAGE_DIR=/data PORT=3000
EXPOSE 3000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e "const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/healthz');process.exit(r.ok?0:1)"
ENTRYPOINT ["bun", "src/main.ts"]
