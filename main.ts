import { Actor } from 'apify';
import { PuppeteerCrawler } from 'crawlee';
import { router } from './routes.js';
import { IndeedInput } from './types.js';

async function main() {
    try {
        // Initialize the Actor
        await Actor.init();

        // Get the input from the Actor
        const input = await Actor.getInput<IndeedInput>();

        if (!input) {
            throw new Error('Input is required. Please provide a valid input with position, country, and location.');
        }

        // Construct the Indeed search URL
        const indeedUrl = `https://${input.country.toLowerCase()}.indeed.com/jobs?q=${encodeURIComponent(input.position)}&l=${encodeURIComponent(input.location)}`;

        // Create a proxy configuration
        const proxyConfiguration = await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL'],
            countryCode: input.country,
        });

        if (!proxyConfiguration) {
            throw new Error('Failed to create proxy configuration. Please check your Apify account settings.');
        }

        // Create the crawler with specific configuration for Indeed
        const crawler = new PuppeteerCrawler({
            proxyConfiguration,
            requestHandler: router,
            maxRequestsPerCrawl: input.maxItems,
            maxConcurrency: 3, // Reduced concurrency to be more gentle
            maxRequestRetries: 3,
            browserPoolOptions: {
                useFingerprints: true,
                fingerprintOptions: {
                    fingerprintGeneratorOptions: {
                        browsers: ['chrome'],
                        operatingSystems: ['linux'],
                    },
                },
            },
            // Add a preNavigation hook to handle cookies and other pre-request setup
            preNavigationHooks: [
                async (crawlingContext) => {
                    const { page } = crawlingContext;
                    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
                    // Add a delay between requests
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
            ],
        });

        // Start the crawler with the Indeed search URL
        await crawler.run([indeedUrl]);

        // Gracefully exit the Actor
        await Actor.exit();
    } catch (error) {
        console.error('Error running the actor:', error);
        await Actor.exit('FAILED');
    }
}

main(); 