# Task-owned LOCAL media processor image (exercise media local build).
# Official Alpine base pinned by digest; FFmpeg from Alpine's signed community
# repository pinned to an exact package version. Runs as an unprivileged user.
# The backend runs it with --network none, a read-only root filesystem and
# resource limits (see backend/src/services/exerciseMedia/ffmpegProcessor.js).
# Not a production worker: hosted processing is a separate gate.
FROM alpine@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
RUN apk add --no-cache ffmpeg=6.1.2-r2 \
 && adduser -D -H -u 10001 media \
 && ffmpeg -hide_banner -version | head -1 \
 && ffprobe -hide_banner -version | head -1
LABEL com.cvfpt.owner="exercise-media-local-20261015" \
      com.cvfpt.purpose="local exercise media processor (ffmpeg/ffprobe)" \
      org.opencontainers.image.base.digest="sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8"
USER 10001
WORKDIR /work
