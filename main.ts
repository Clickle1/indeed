import { Actor } from 'apify';
import { Dataset } from '@crawlee/core';
import { gotScraping } from 'got-scraping';

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
        const { searchQuery = 'web developer', location = 'London', maxPages = 5 } = input ?? {};

        // Initialize proxy configuration
        const proxyConfiguration = await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL'],
        });

        if (!proxyConfiguration) {
            throw new Error('Failed to initialize proxy configuration');
        }

        console.log('Proxy configuration initialized successfully');

        // Create a URL for the search
        const searchUrl = `https://uk.indeed.com/jobs?q=${encodeURIComponent(searchQuery)}&l=${encodeURIComponent(location)}`;

        // Function to extract job data from HTML
        function extractJobData(html: string) {
            const jobData = {
                title: '',
                company: '',
                location: '',
                salary: '',
                description: '',
                url: '',
            };

            // Extract title
            const titleMatch = html.match(/<h1[^>]*class="jobsearch-JobInfoHeader-title"[^>]*>(.*?)<\/h1>/);
            if (titleMatch) {
                jobData.title = titleMatch[1].trim();
            }

            // Extract company
            const companyMatch = html.match(/<div[^>]*data-company-name="true"[^>]*>(.*?)<\/div>/);
            if (companyMatch) {
                jobData.company = companyMatch[1].trim();
            }

            // Extract location
            const locationMatch = html.match(/<div[^>]*data-testid="job-location"[^>]*>(.*?)<\/div>/);
            if (locationMatch) {
                jobData.location = locationMatch[1].trim();
            }

            // Extract salary
            const salaryMatch = html.match(/<div[^>]*data-testid="job-salary"[^>]*>(.*?)<\/div>/);
            if (salaryMatch) {
                jobData.salary = salaryMatch[1].trim();
            }

            // Extract description
            const descriptionMatch = html.match(/<div[^>]*id="jobDescriptionText"[^>]*>(.*?)<\/div>/);
            if (descriptionMatch) {
                jobData.description = descriptionMatch[1].trim();
            }

            return jobData;
        }

        // Function to extract job links from search results
        function extractJobLinks(html: string) {
            const jobLinks: string[] = [];
            const regex = /<a[^>]*data-jk="([^"]*)"[^>]*>/g;
            let match;

            while ((match = regex.exec(html)) !== null) {
                jobLinks.push(`https://uk.indeed.com/viewjob?jk=${match[1]}`);
            }

            return jobLinks;
        }

        // Function to extract next page URL
        function extractNextPageUrl(html: string): string | null {
            const nextPageMatch = html.match(/<a[^>]*data-testid="pagination-page-next"[^>]*href="([^"]*)"[^>]*>/);
            if (nextPageMatch) {
                return new URL(nextPageMatch[1], 'https://uk.indeed.com').toString();
            }
            return null;
        }

        // Main scraping function
        async function scrapeJobs() {
            let currentPage = 1;
            let currentUrl: string | null = searchUrl;

            while (currentPage <= maxPages && currentUrl) {
                try {
                    // Add random delay between requests
                    await new Promise(resolve => setTimeout(resolve, Math.random() * 5000 + 5000));

                    // Get proxy URL
                    const proxyUrl = await proxyConfiguration?.newUrl();

                    // Make the request with got-scraping
                    const response = await gotScraping.get(currentUrl, {
                        proxyUrl,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                            'Accept-Language': 'en-GB,en;q=0.5',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Connection': 'keep-alive',
                            'Upgrade-Insecure-Requests': '1',
                            'Sec-Fetch-Dest': 'document',
                            'Sec-Fetch-Mode': 'navigate',
                            'Sec-Fetch-Site': 'none',
                            'Sec-Fetch-User': '?1',
                            'Cache-Control': 'max-age=0',
                            'DNT': '1',
                        },
                        timeout: {
                            request: 30000
                        }
                    });

                    const html = response.body;

                    // Extract job links
                    const jobLinks = extractJobLinks(html);

                    // Process each job link
                    for (const jobUrl of jobLinks) {
                        try {
                            // Add random delay between job requests
                            await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 2000));

                            // Get job details
                            const jobResponse = await gotScraping.get(jobUrl, {
                                proxyUrl,
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                                    'Accept-Language': 'en-GB,en;q=0.5',
                                    'Accept-Encoding': 'gzip, deflate, br',
                                    'Connection': 'keep-alive',
                                    'Upgrade-Insecure-Requests': '1',
                                    'Sec-Fetch-Dest': 'document',
                                    'Sec-Fetch-Mode': 'navigate',
                                    'Sec-Fetch-Site': 'same-origin',
                                    'Sec-Fetch-User': '?1',
                                    'Cache-Control': 'max-age=0',
                                    'DNT': '1',
                                },
                                timeout: {
                                    request: 30000
                                }
                            });

                            const jobData = extractJobData(jobResponse.body);
                            jobData.url = jobUrl;

                            // Save the job data
                            await Dataset.pushData(jobData);
                        } catch (error) {
                            console.error(`Error processing job ${jobUrl}:`, error);
                        }
                    }

                    // Get next page URL
                    currentUrl = extractNextPageUrl(html);
                    currentPage++;

                } catch (error) {
                    console.error(`Error processing page ${currentPage}:`, error);
                    break;
                }
            }
        }

        // Start scraping
        await scrapeJobs();

        // Gracefully exit the Actor
        await Actor.exit();
    } catch (error) {
        console.error('Error running the actor:', error);
        await Actor.exit('FAILED');
    }
}

main(); 