import { Actor } from 'apify';
import { Dataset } from '@crawlee/core';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { ProxyConfiguration } from '@crawlee/browser';

// Add type declarations
declare module 'puppeteer-extra' {
    interface HTTPRequest {
        continue(options?: { headers?: Record<string, string> }): Promise<void>;
    }
}

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Function to get next page URL
async function getNextPageUrl(currentUrl: string, pageNumber: number): Promise<string | null> {
    if (pageNumber >= 10) {
        console.log('Reached maximum page limit of 10');
        return null;
    }

    const start = pageNumber * 10;
    const url = new URL(currentUrl);
    url.searchParams.set('start', start.toString());
    
    console.log(`Generated next page URL: ${url.toString()}`);
    return url.toString();
}

async function scrapeJobs(position: string, location: string, maxItems: number = 100) {
    console.log('Starting job scraping process');
    const proxyConfiguration = await Actor.createProxyConfiguration({
        groups: ['RESIDENTIAL'],
    });

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920x1080',
        ],
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Set up request interception
        await page.setRequestInterception(true);
        page.on('request', async (request) => {
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
            };
            await request.continue({ headers });
        });

        const searchUrl = `https://uk.indeed.com/jobs?q=${encodeURIComponent(position)}&l=${encodeURIComponent(location)}`;
        console.log('Search URL:', searchUrl);

        let currentUrl = searchUrl;
        let currentPage = 1;
        let totalJobs = 0;

        while (currentUrl && totalJobs < maxItems) {
            console.log(`Processing page ${currentPage}`);
            
            // Add random delay between requests
            const delay = Math.floor(Math.random() * 5000) + 5000;
            console.log(`Waiting ${delay}ms before next request`);
            await new Promise(resolve => setTimeout(resolve, delay));

            try {
                await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 30000 });
                
                // Random scrolling to mimic human behavior
                await page.evaluate(() => {
                    window.scrollTo(0, Math.random() * document.body.scrollHeight);
                });
                await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

                const jobLinks = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a.jcs-JobTitle'));
                    return links.map(link => link.href);
                });

                console.log(`Found ${jobLinks.length} job links on page ${currentPage}`);

                for (const jobLink of jobLinks) {
                    if (totalJobs >= maxItems) {
                        console.log('Reached maximum items limit');
                        break;
                    }

                    try {
                        await page.goto(jobLink, { waitUntil: 'networkidle0', timeout: 30000 });
                        
                        const jobData = await page.evaluate(() => {
                            const title = document.querySelector('span[id^="jobTitle-"]')?.textContent?.trim();
                            const company = document.querySelector('span[data-testid="company-name"]')?.textContent?.trim();
                            const location = document.querySelector('div[data-testid="text-location"]')?.textContent?.trim();
                            const salary = document.querySelector('div[data-testid="attribute_snippet_testid"]')?.textContent?.trim();
                            const jobType = document.querySelectorAll('div[data-testid="attribute_snippet_testid"]')[1]?.textContent?.trim();
                            const rating = document.querySelector('span[aria-hidden="true"]')?.textContent?.trim();

                            return {
                                title,
                                company,
                                location,
                                salary,
                                jobType,
                                rating,
                                url: window.location.href
                            };
                        });

                        if (jobData.title) {
                            await Actor.pushData(jobData);
                            totalJobs++;
                            console.log(`Saved job: ${jobData.title} (${totalJobs}/${maxItems})`);
                        }

                        // Random delay between job detail requests
                        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
                    } catch (error) {
                        console.error(`Error processing job link ${jobLink}:`, error);
                    }
                }

                // Get next page URL
                const nextUrl = await getNextPageUrl(currentUrl, currentPage);
                if (nextUrl) {
                    currentUrl = nextUrl;
                    currentPage++;
                } else {
                    console.log('No more pages to process');
                    break;
                }
            } catch (error) {
                console.error(`Error processing page ${currentPage}:`, error);
                break;
            }
        }

        console.log(`Scraping completed. Total jobs saved: ${totalJobs}`);
    } finally {
        await browser.close();
    }
}

async function main() {
    try {
        // Initialize the Actor
        await Actor.init();
        console.log('Actor initialized successfully');

        interface Input {
            position: string;
            country: string;
            location: string;
            maxItems?: number;
            parseCompanyDetails?: boolean;
            saveOnlyUniqueItems?: boolean;
            followApplyRedirects?: boolean;
        }

        const input = await Actor.getInput<Input>();
        console.log('Input received:', input);
        
        const { 
            position = 'web developer', 
            country = 'UK',
            location = 'London', 
            maxItems = 50,
            parseCompanyDetails = false,
            saveOnlyUniqueItems = true,
            followApplyRedirects = false
        } = input ?? {};

        console.log('Using parameters:', { position, country, location, maxItems, parseCompanyDetails, saveOnlyUniqueItems, followApplyRedirects });

        // Initialize proxy configuration
        const proxyConfiguration = await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL'],
        });

        if (!proxyConfiguration) {
            throw new Error('Failed to initialize proxy configuration');
        }

        console.log('Proxy configuration initialized successfully');

        // Create a URL for the search
        const searchUrl = `https://uk.indeed.com/jobs?q=${encodeURIComponent(position)}&l=${encodeURIComponent(location)}`;
        console.log('Search URL:', searchUrl);

        // Launch browser with proxy
        console.log('Launching browser with proxy');
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
            ],
        });

        // Create a new page
        console.log('Creating new page');
        const page = await browser.newPage();

        // Set viewport
        await page.setViewport({
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1,
        });

        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Set extra headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-GB,en;q=0.9',
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

        // Enable JavaScript
        await page.setJavaScriptEnabled(true);

        // Main scraping function
        async function scrapeJobs() {
            console.log('Starting job scraping');
            let currentPage = 1;
            let currentUrl: string | null = searchUrl;
            let totalItems = 0;

            while (currentPage <= 10 && currentUrl && totalItems < maxItems) {
                try {
                    console.log(`Processing page ${currentPage}: ${currentUrl}`);
                    
                    // Add random delay between requests
                    const delay = Math.random() * 5000 + 5000;
                    console.log(`Waiting ${Math.round(delay/1000)} seconds before next request`);
                    await new Promise(resolve => setTimeout(resolve, delay));

                    // Navigate to the page
                    console.log('Navigating to page');
                    await page.goto(currentUrl, {
                        waitUntil: 'networkidle2',
                        timeout: 30000,
                    });

                    // Wait for job cards to load
                    console.log('Waiting for job cards to load');
                    await page.waitForSelector('.job_seen_beacon', { timeout: 10000 }).catch(() => {
                        console.log('No job cards found on page');
                    });

                    // Get page content
                    const html = await page.content();
                    console.log('Page content loaded');

                    // Extract job links
                    const jobLinks = await page.evaluate(() => {
                        const links: string[] = [];
                        document.querySelectorAll('.job_seen_beacon a.jcs-JobTitle').forEach((link) => {
                            const href = link.getAttribute('href');
                            if (href) {
                                links.push(new URL(href, window.location.origin).href);
                            }
                        });
                        return links;
                    });

                    console.log(`Found ${jobLinks.length} job links`);

                    // Process each job link
                    for (const jobUrl of jobLinks) {
                        if (totalItems >= maxItems) {
                            console.log('Reached maximum items limit');
                            break;
                        }

                        try {
                            console.log(`Processing job: ${jobUrl}`);
                            
                            // Add random delay between job requests
                            const jobDelay = Math.random() * 3000 + 2000;
                            console.log(`Waiting ${Math.round(jobDelay/1000)} seconds before next job request`);
                            await new Promise(resolve => setTimeout(resolve, jobDelay));

                            // Navigate to job page
                            console.log('Navigating to job page');
                            await page.goto(jobUrl, {
                                waitUntil: 'networkidle2',
                                timeout: 30000,
                            });

                            // Wait for job details to load
                            console.log('Waiting for job details to load');
                            await page.waitForSelector('#vjs-container', { timeout: 10000 }).catch(() => {
                                console.log('No job details container found');
                            });

                            // Get job data
                            const jobData = await page.evaluate(() => {
                                const container = document.querySelector('#vjs-container');
                                if (!container) return null;

                                const title = container.querySelector('h2.jobsearch-JobInfoHeader-title')?.textContent?.trim() || '';
                                const company = container.querySelector('[data-company-name="true"]')?.textContent?.trim() || '';
                                const location = container.querySelector('[data-testid="inlineHeader-companyLocation"]')?.textContent?.trim() || '';
                                const salary = container.querySelector('[data-testid^="£"]')?.textContent?.trim() || '';
                                const jobType = container.querySelector('[data-testid$="-tile"]')?.textContent?.trim() || '';
                                const description = container.querySelector('#jobDescriptionText')?.textContent?.trim() || '';
                                const remote = container.textContent?.includes('Remote') || container.textContent?.includes('remote') || container.textContent?.includes('Work from home') || false;

                                return {
                                    title,
                                    company,
                                    location,
                                    salary,
                                    jobType,
                                    description,
                                    remote,
                                    url: window.location.href,
                                };
                            });

                            if (jobData) {
                                // Save the job data
                                console.log('Saving job data to dataset');
                                await Dataset.pushData(jobData);
                                console.log('Job data saved successfully');
                                
                                totalItems++;
                                console.log(`Total items processed: ${totalItems}`);
                            }

                        } catch (error) {
                            console.error(`Error processing job ${jobUrl}:`, error);
                        }
                    }

                    // Get next page URL using start parameter
                    currentUrl = await getNextPageUrl(currentUrl, currentPage + 1);
                    currentPage++;

                } catch (error) {
                    console.error(`Error processing page ${currentPage}:`, error);
                    break;
                }
            }
        }

        // Start scraping
        console.log('Starting main scraping process');
        await scrapeJobs();
        console.log('Scraping completed successfully');

        // Close browser
        await browser.close();

        // Gracefully exit the Actor
        await Actor.exit();
    } catch (error) {
        console.error('Error running the actor:', error);
        await Actor.exit('FAILED');
    }
}

main(); 