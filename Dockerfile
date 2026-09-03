# Use official Node.js lightweight Alpine image
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package metadata first for optimal layer caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source code
COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/
COPY scripts/ ./scripts/

# Create directory for persistent uploads
RUN mkdir -p /app/uploads/temp && chown -R node:node /app

# Use non-root node user for security
USER node

# Expose server port
EXPOSE 3000

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/info || exit 1

# Start the application server
CMD ["node", "server.js"]
