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

        // Construct the Indeed search URL using www.indeed.com
        const indeedUrl = `https://www.indeed.com/jobs?q=${encodeURIComponent(input.position)}&l=${encodeURIComponent(input.location)}`;

        // Create the crawler with specific configuration for Indeed
        const crawler = new PuppeteerCrawler({
            requestHandler: router,
            maxRequestsPerCrawl: input.maxItems,
            maxConcurrency: 1,
            maxRequestRetries: 1,
            navigationTimeoutSecs: 60,
            proxyConfiguration: await Actor.createProxyConfiguration({
                groups: ['RESIDENTIAL'],
                countryCode: 'US',
            }),
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
                        '--disable-site-isolation-trials',
                        '--disable-features=BlockInsecurePrivateNetworkRequests',
                        '--disable-features=IsolateOrigins',
                        '--disable-features=site-per-process',
                    ],
                } as LaunchOptions,
            },
            preNavigationHooks: [
                async (crawlingContext) => {
                    const { page, request } = crawlingContext;
                    
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
                        'Cache-Control': 'max-age=0',
                        'DNT': '1',
                    });

                    // Add a random delay between 5-15 seconds
                    const delay = Math.floor(Math.random() * 10000) + 5000;
                    await new Promise(resolve => setTimeout(resolve, delay));

                    try {
                        // First visit the homepage to get cookies
                        await page.goto('https://www.indeed.com', {
                            waitUntil: ['domcontentloaded'],
                            timeout: 30000
                        });

                        // Wait a bit before going to the search page
                        await new Promise(resolve => setTimeout(resolve, 3000));

                        // Now go to the search page
                        await page.goto(request.url, {
                            waitUntil: ['domcontentloaded', 'networkidle2'],
                            timeout: 60000
                        });

                        // Wait for a short time to let any dynamic content load
                        await new Promise(resolve => setTimeout(resolve, 5000));

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

                        // Check if we're on the main page with more robust selectors
                        const pageContent = await page.evaluate(() => {
                            const selectors = [
                                'div[class*="jobsearch"]',
                                'div[class*="job_seen_beacon"]',
                                'div[class*="jobsearch-ResultsList"]',
                                'div[class*="jobsearch-SerpJobCard"]',
                                'div[class*="jobsearch-LeftPane"]',
                                'div[class*="jobsearch-RightPane"]'
                            ];
                            
                            // Check if any of the selectors exist
                            const hasJobElements = selectors.some(selector => 
                                document.querySelector(selector) !== null
                            );

                            // Get the page title and URL for debugging
                            return {
                                hasJobElements,
                                title: document.title,
                                url: window.location.href,
                                bodyText: document.body.innerText.substring(0, 200) // First 200 chars for debugging
                            };
                        });

                        console.log('Page content check:', pageContent);

                        if (!pageContent.hasJobElements) {
                            console.log('Not on the main job search page. Page details:', pageContent);
                            throw new Error('Not on main job search page');
                        }
                    } catch (error) {
                        console.error('Navigation error:', error);
                        throw error;
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