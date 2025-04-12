import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset } from '@crawlee/puppeteer';
import type { LaunchOptions } from 'puppeteer';

async function main() {
    try {
        // Initialize the Actor
        await Actor.init();

        interface Input {
            searchQuery: string;
            location: string;
            maxPages?: number;
        }

        const input = await Actor.getInput<Input>();
        const { searchQuery = 'web developer', location = 'San Francisco', maxPages = 5 } = input ?? {};

        // Initialize proxy configuration
        const proxyConfiguration = await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL'],
        });

        if (!proxyConfiguration) {
            throw new Error('Failed to initialize proxy configuration');
        }

        console.log('Proxy configuration initialized successfully');

        // Create a URL for the search
        const searchUrl = `https://www.indeed.com/jobs?q=${encodeURIComponent(searchQuery)}&l=${encodeURIComponent(location)}`;

        // Initialize the crawler
        const crawler = new PuppeteerCrawler({
            proxyConfiguration,
            maxConcurrency: 1,
            maxRequestRetries: 3,
            requestHandlerTimeoutSecs: 60,
            navigationTimeoutSecs: 60,
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
                    headless: true,
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
                    ],
                } as LaunchOptions,
            },
            preNavigationHooks: [
                async ({ page, request }) => {
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

                    // First visit the homepage to get cookies
                    await page.goto('https://www.indeed.com', {
                        waitUntil: ['domcontentloaded'],
                        timeout: 30000
                    });

                    // Wait a bit before going to the search page
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            ],
            async requestHandler({ page, request, log }) {
                const { url } = request;

                // Navigate to the search page
                await page.goto(url, {
                    waitUntil: ['domcontentloaded', 'networkidle2'],
                    timeout: 60000
                });

                // Wait for a short time to let any dynamic content load
                await new Promise(resolve => setTimeout(resolve, 5000));

                // Check if we're on a search results page
                if (url.includes('/jobs?')) {
                    log.info(`Processing search results page: ${url}`);
                    
                    // Extract job links
                    const jobLinks = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('a[data-jk]'))
                            .map(el => `https://www.indeed.com/viewjob?jk=${el.getAttribute('data-jk')}`);
                    });

                    // Add job detail pages to the queue
                    await crawler.addRequests(jobLinks);

                    // Check for pagination
                    const nextPage = await page.evaluate(() => {
                        const nextButton = document.querySelector('a[data-testid="pagination-page-next"]');
                        return nextButton ? nextButton.getAttribute('href') : null;
                    });

                    if (nextPage) {
                        const nextPageUrl = new URL(nextPage, 'https://www.indeed.com').toString();
                        await crawler.addRequests([nextPageUrl]);
                    }
                } 
                // Handle job detail pages
                else if (url.includes('/viewjob?')) {
                    log.info(`Processing job detail page: ${url}`);
                    
                    const jobData = await page.evaluate(() => {
                        return {
                            title: document.querySelector('h1.jobsearch-JobInfoHeader-title')?.textContent?.trim() || '',
                            company: document.querySelector('div[data-company-name="true"]')?.textContent?.trim() || '',
                            location: document.querySelector('div[data-testid="job-location"]')?.textContent?.trim() || '',
                            salary: document.querySelector('div[data-testid="job-salary"]')?.textContent?.trim() || '',
                            description: document.querySelector('div#jobDescriptionText')?.textContent?.trim() || '',
                            url: window.location.href,
                        };
                    });

                    // Save the job data
                    await Dataset.pushData(jobData);
                }
            },
        });

        // Start the crawler
        await crawler.run([searchUrl]);

        // Gracefully exit the Actor
        await Actor.exit();
    } catch (error) {
        console.error('Error running the actor:', error);
        await Actor.exit('FAILED');
    }
}

main(); 