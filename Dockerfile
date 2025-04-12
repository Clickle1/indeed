FROM apify/actor-node:20

# Install global dependencies
RUN npm install -g typescript

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . ./

# Build TypeScript
RUN npm run build

# Set the command to run the actor
CMD ["npm", "start"] 