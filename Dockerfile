FROM apify/actor-node:20

# Install TypeScript globally
RUN npm install -g typescript

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . ./

# Build TypeScript
RUN npm run build

# Set the start command
CMD ["npm", "start"] 