FROM apify/actor-node-playwright-chrome:20

# Copy package files first for layer caching
COPY package*.json ./

# Install dependencies (including dev for build)
RUN npm install --include=dev --audit=false

# Copy source code
COPY . ./

# Build TypeScript
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Run the production build
CMD npm run start:prod
