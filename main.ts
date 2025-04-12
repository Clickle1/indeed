import { Actor } from 'apify';
import { Dataset } from '@crawlee/core';
import { gotScraping } from 'got-scraping';

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

        // Function to extract job data from HTML
        function extractJobData(html: string) {
            console.log('Extracting job data from HTML');
            const jobData = {
                title: '',
                company: '',
                location: '',
                salary: '',
                description: '',
                url: '',
                applyUrl: '',
                companyUrl: '',
                companyDescription: '',
                companyRating: '',
                companyReviews: '',
                jobType: '',
                postedDate: '',
                remote: false,
            };

            // Try to extract from detailed view first
            const detailedViewMatch = html.match(/<div class="jobsearch-FederatedViewJob">/);
            if (detailedViewMatch) {
                console.log('Found detailed view structure');
                // Extract title from detailed view
                const titleMatch = html.match(/<h2[^>]*class="jobsearch-JobInfoHeader-title"[^>]*>(.*?)<\/h2>/);
                if (titleMatch) {
                    jobData.title = titleMatch[1].replace(/<span[^>]*>.*?<\/span>/g, '').trim();
                }

                // Extract company from detailed view
                const companyMatch = html.match(/<div[^>]*data-company-name="true"[^>]*>(.*?)<\/div>/);
                if (companyMatch) {
                    jobData.company = companyMatch[1].trim();
                }

                // Extract location from detailed view
                const locationMatch = html.match(/<div[^>]*data-testid="inlineHeader-companyLocation"[^>]*>(.*?)<\/div>/);
                if (locationMatch) {
                    jobData.location = locationMatch[1].replace(/<span[^>]*>.*?<\/span>/g, '').trim();
                }

                // Extract salary from detailed view
                const salaryMatch = html.match(/<div[^>]*data-testid="£[^"]*-tile"[^>]*>(.*?)<\/div>/);
                if (salaryMatch) {
                    jobData.salary = salaryMatch[1].replace(/<[^>]*>/g, '').trim();
                }

                // Extract job type from detailed view
                const jobTypeMatch = html.match(/<div[^>]*data-testid="[^"]*-tile"[^>]*>(.*?)<\/div>/g);
                if (jobTypeMatch && jobTypeMatch.length > 1) {
                    jobData.jobType = jobTypeMatch[1].replace(/<[^>]*>/g, '').trim();
                }

                // Extract description from detailed view
                const descriptionMatch = html.match(/<div[^>]*id="jobDescriptionText"[^>]*>(.*?)<\/div>/);
                if (descriptionMatch) {
                    jobData.description = descriptionMatch[1].trim();
                }

                // Extract company rating from detailed view
                const ratingMatch = html.match(/<span[^>]*aria-hidden="true"[^>]*>(.*?)<\/span>/);
                if (ratingMatch) {
                    jobData.companyRating = ratingMatch[1].trim();
                }

                // Check for remote status
                if (html.includes('Remote') || html.includes('remote')) {
                    jobData.remote = true;
                }
            } else {
                console.log('Using job card structure');
                // Extract from job card structure
                const titleMatch = html.match(/<span[^>]*id="jobTitle-[^"]*"[^>]*>(.*?)<\/span>/);
                if (titleMatch) {
                    jobData.title = titleMatch[1].trim();
                }

                const companyMatch = html.match(/<span[^>]*data-testid="company-name"[^>]*>(.*?)<\/span>/);
                if (companyMatch) {
                    jobData.company = companyMatch[1].trim();
                }

                const locationMatch = html.match(/<div[^>]*data-testid="text-location"[^>]*>(.*?)<\/div>/);
                if (locationMatch) {
                    jobData.location = locationMatch[1].trim();
                }

                const salaryMatch = html.match(/<div[^>]*data-testid="attribute_snippet_testid"[^>]*>(.*?)<\/div>/);
                if (salaryMatch) {
                    jobData.salary = salaryMatch[1].trim();
                }

                const jobTypeMatch = html.match(/<div[^>]*data-testid="attribute_snippet_testid"[^>]*>(.*?)<\/div>/g);
                if (jobTypeMatch && jobTypeMatch.length > 1) {
                    jobData.jobType = jobTypeMatch[1].replace(/<[^>]*>/g, '').trim();
                }

                const ratingMatch = html.match(/<span[^>]*aria-hidden="true"[^>]*>(.*?)<\/span>/);
                if (ratingMatch) {
                    jobData.companyRating = ratingMatch[1].trim();
                }
            }

            console.log('Extracted job data:', jobData);
            return jobData;
        }

        // Function to extract job links from search results
        function extractJobLinks(html: string) {
            console.log('Extracting job links from HTML');
            const jobLinks: string[] = [];
            
            // Try different patterns for job links
            const patterns = [
                /<a[^>]*class="jcs-JobTitle"[^>]*href="([^"]*)"[^>]*>/g,
                /<a[^>]*data-jk="([^"]*)"[^>]*>/g,
                /<a[^>]*href="\/pagead\/clk\?mo=([^"]*)"[^>]*>/g,
                /<a[^>]*href="\/viewjob\?jk=([^"]*)"[^>]*>/g,
                /<a[^>]*href="\/rc\/clk\?jk=([^"]*)"[^>]*>/g,
                /<a[^>]*class="jobTitle"[^>]*href="([^"]*)"[^>]*>/g,
                /<a[^>]*class="tapItem"[^>]*href="([^"]*)"[^>]*>/g
            ];

            for (const pattern of patterns) {
                let match;
                while ((match = pattern.exec(html)) !== null) {
                    let jobUrl;
                    if (pattern.toString().includes('href="')) {
                        // If we matched a full URL, use it directly
                        jobUrl = match[1];
                        if (!jobUrl.startsWith('http')) {
                            jobUrl = `https://uk.indeed.com${jobUrl}`;
                        }
                    } else {
                        // If we matched a job ID, construct the URL
                        const jobId = match[1];
                        jobUrl = `https://uk.indeed.com/viewjob?jk=${jobId}`;
                    }
                    
                    if (!jobLinks.includes(jobUrl)) {
                        jobLinks.push(jobUrl);
                    }
                }
            }

            console.log(`Found ${jobLinks.length} job links`);
            return jobLinks;
        }

        // Function to extract next page URL
        function extractNextPageUrl(html: string): string | null {
            console.log('Extracting next page URL');
            const patterns = [
                /<a[^>]*aria-label="Next Page"[^>]*href="([^"]*)"[^>]*>/,
                /<a[^>]*class="pagination-next"[^>]*href="([^"]*)"[^>]*>/,
                /<a[^>]*class="np"[^>]*href="([^"]*)"[^>]*>/,
                /<a[^>]*data-testid="pagination-page-next"[^>]*href="([^"]*)"[^>]*>/,
                /<a[^>]*class="pagination-list"[^>]*href="([^"]*)"[^>]*>/,
                /<a[^>]*class="pagination-link"[^>]*href="([^"]*)"[^>]*>/
            ];

            for (const pattern of patterns) {
                const nextPageMatch = html.match(pattern);
                if (nextPageMatch) {
                    let nextUrl = nextPageMatch[1];
                    if (!nextUrl.startsWith('http')) {
                        nextUrl = `https://uk.indeed.com${nextUrl}`;
                    }
                    console.log('Next page URL:', nextUrl);
                    return nextUrl;
                }
            }

            console.log('No next page URL found');
            return null;
        }

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

                    // Get proxy URL
                    console.log('Getting proxy URL');
                    const proxyUrl = await proxyConfiguration?.newUrl();
                    console.log('Using proxy URL:', proxyUrl);

                    // Make the request with got-scraping
                    console.log('Making request to search page');
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

                    console.log('Received response from search page');
                    const html = response.body;
                    
                    // Debug HTML content
                    console.log('Response status:', response.statusCode);
                    console.log('Response headers:', response.headers);
                    console.log('HTML length:', html.length);
                    console.log('First 500 chars of HTML:', html.substring(0, 500));
                    console.log('Last 500 chars of HTML:', html.substring(html.length - 500));

                    // Extract job links
                    const jobLinks = extractJobLinks(html);

                    // Process each job link
                    for (const jobUrl of jobLinks) {
                        try {
                            console.log(`Processing job: ${jobUrl}`);
                            
                            // Add random delay between job requests
                            const jobDelay = Math.random() * 3000 + 2000;
                            console.log(`Waiting ${Math.round(jobDelay/1000)} seconds before next job request`);
                            await new Promise(resolve => setTimeout(resolve, jobDelay));

                            // Get job details
                            console.log('Making request to job page');
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

                            console.log('Received response from job page');
                            const jobData = extractJobData(jobResponse.body);
                            jobData.url = jobUrl;

                            // Save the job data
                            console.log('Saving job data to dataset');
                            await Dataset.pushData(jobData);
                            console.log('Job data saved successfully');
                            
                            totalItems++;
                            console.log(`Total items processed: ${totalItems}`);

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
        console.log('Starting main scraping process');
        await scrapeJobs();
        console.log('Scraping completed successfully');

        // Gracefully exit the Actor
        await Actor.exit();
    } catch (error) {
        console.error('Error running the actor:', error);
        await Actor.exit('FAILED');
    }
}

main(); 