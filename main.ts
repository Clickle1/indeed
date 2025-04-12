import { Actor } from 'apify';
import { CheerioCrawler, Dataset } from '@crawlee/cheerio';
import { ProxyConfiguration } from '@crawlee/browser';

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
        const crawler = new CheerioCrawler({
            proxyConfiguration,
            maxConcurrency: 1,
            maxRequestRetries: 3,
            requestHandlerTimeoutSecs: 60,
            navigationTimeoutSecs: 60,
            additionalMimeTypes: ['text/plain'],
            preNavigationHooks: [
                async ({ request, session, proxyInfo }) => {
                    // Add delay between requests
                    await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 5000));
                    
                    // Set headers to look more like a browser
                    request.headers = {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
                    };
                }
            ],
            async requestHandler({ request, $, log }) {
                const { url } = request;

                // Check if we're on a search results page
                if (url.includes('/jobs?')) {
                    log.info(`Processing search results page: ${url}`);
                    
                    // Extract job links
                    const jobLinks = $('a[data-jk]')
                        .map((_, el) => `https://www.indeed.com/viewjob?jk=${$(el).attr('data-jk')}`)
                        .get();

                    // Add job detail pages to the queue
                    await crawler.addRequests(jobLinks);

                    // Check for pagination
                    const nextPage = $('a[data-testid="pagination-page-next"]').attr('href');
                    if (nextPage) {
                        const nextPageUrl = new URL(nextPage, 'https://www.indeed.com').toString();
                        await crawler.addRequests([nextPageUrl]);
                    }
                } 
                // Handle job detail pages
                else if (url.includes('/viewjob?')) {
                    log.info(`Processing job detail page: ${url}`);
                    
                    const jobData = {
                        title: $('h1.jobsearch-JobInfoHeader-title').text().trim(),
                        company: $('div[data-company-name="true"]').text().trim(),
                        location: $('div[data-testid="job-location"]').text().trim(),
                        salary: $('div[data-testid="job-salary"]').text().trim(),
                        description: $('div#jobDescriptionText').text().trim(),
                        url: url,
                    };

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