import { Actor } from 'apify';
import { PuppeteerCrawler } from 'crawlee';
import { router } from './routes.js';
import { IndeedInput } from './types.js';
import type { LaunchOptions } from 'puppeteer';

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

        // Create the crawler with specific configuration for Indeed
        const crawler = new PuppeteerCrawler({
            requestHandler: router,
            maxRequestsPerCrawl: input.maxItems,
            maxConcurrency: 1,
            maxRequestRetries: 1,
            browserPoolOptions: {
                useFingerprints: true,
                fingerprintOptions: {
                    fingerprintGeneratorOptions: {
                        browsers: ['chrome'],
                        operatingSystems: ['linux'],
                    },
                },
            },
            launchContext: {
                launchOptions: {
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--disable-gpu',
                        '--window-size=1920,1080',
                        '--disable-web-security',
                        '--disable-features=IsolateOrigins,site-per-process',
                        '--disable-blink-features=AutomationControlled',
                    ],
                } as LaunchOptions,
            },
            // Add a preNavigation hook to handle cookies and other pre-request setup
            preNavigationHooks: [
                async (crawlingContext) => {
                    const { page } = crawlingContext;
                    
                    // Set a modern user agent
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
                    
                    // Set headers to look more like a regular browser
                    await page.setExtraHTTPHeaders({
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                    });

                    // Add a random delay between 5-15 seconds
                    const delay = Math.floor(Math.random() * 10000) + 5000;
                    await new Promise(resolve => setTimeout(resolve, delay));

                    // Check for CAPTCHA after navigation
                    await page.waitForNavigation({ waitUntil: 'networkidle0' });
                    
                    // Check if we're on a CAPTCHA page
                    const isCaptcha = await page.evaluate(() => {
                        return document.querySelector('form[action*="verify"]') !== null ||
                               document.querySelector('iframe[src*="captcha"]') !== null ||
                               document.querySelector('div[class*="captcha"]') !== null;
                    });

                    if (isCaptcha) {
                        console.log('CAPTCHA detected. Please solve it manually or use a different approach.');
                        throw new Error('CAPTCHA detected');
                    }
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