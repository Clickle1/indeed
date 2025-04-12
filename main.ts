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

            // Check if we have the detailed view container
            const detailedViewMatch = html.match(/<div[^>]*id="vjs-container"[^>]*>(.*?)<\/div>/);
            if (detailedViewMatch) {
                console.log('Found detailed view container');
                const detailedView = detailedViewMatch[1];

                // Extract title from detailed view
                const titleMatch = detailedView.match(/<h2[^>]*class="jobsearch-JobInfoHeader-title"[^>]*>(.*?)<\/h2>/);
                if (titleMatch) {
                    jobData.title = titleMatch[1].replace(/<span[^>]*>.*?<\/span>/g, '').trim();
                }

                // Extract company from detailed view
                const companyMatch = detailedView.match(/<div[^>]*data-company-name="true"[^>]*>(.*?)<\/div>/);
                if (companyMatch) {
                    jobData.company = companyMatch[1].trim();
                }

                // Extract location from detailed view
                const locationMatch = detailedView.match(/<div[^>]*data-testid="inlineHeader-companyLocation"[^>]*>(.*?)<\/div>/);
                if (locationMatch) {
                    jobData.location = locationMatch[1].replace(/<span[^>]*>.*?<\/span>/g, '').trim();
                }

                // Extract salary from detailed view
                const salaryMatch = detailedView.match(/<div[^>]*data-testid="£[^"]*-tile"[^>]*>(.*?)<\/div>/);
                if (salaryMatch) {
                    jobData.salary = salaryMatch[1].replace(/<[^>]*>/g, '').trim();
                }

                // Extract job type from detailed view
                const jobTypeMatch = detailedView.match(/<div[^>]*data-testid="[^"]*-tile"[^>]*>(.*?)<\/div>/g);
                if (jobTypeMatch && jobTypeMatch.length > 1) {
                    jobData.jobType = jobTypeMatch[1].replace(/<[^>]*>/g, '').trim();
                }

                // Extract description from detailed view
                const descriptionMatch = detailedView.match(/<div[^>]*id="jobDescriptionText"[^>]*>(.*?)<\/div>/);
                if (descriptionMatch) {
                    jobData.description = descriptionMatch[1].trim();
                }

                // Extract company rating from detailed view
                const ratingMatch = detailedView.match(/<span[^>]*aria-hidden="true"[^>]*>(.*?)<\/span>/);
                if (ratingMatch) {
                    jobData.companyRating = ratingMatch[1].trim();
                }

                // Check for remote status
                if (detailedView.includes('Remote') || detailedView.includes('remote') || detailedView.includes('Work from home')) {
                    jobData.remote = true;
                }

                // Extract apply URL
                const applyMatch = detailedView.match(/<button[^>]*href="([^"]*)"[^>]*>Apply now<\/button>/);
                if (applyMatch) {
                    jobData.applyUrl = applyMatch[1];
                }
            } else {
                console.log('Using job card structure');
                // Extract from job card structure using UK Indeed patterns
                const titleMatch = html.match(/<h2[^>]*class="jobTitle"[^>]*><span[^>]*>(.*?)<\/span><\/h2>/);
                if (titleMatch) {
                    jobData.title = titleMatch[1].trim();
                }

                const companyMatch = html.match(/<span[^>]*class="companyName"[^>]*>(.*?)<\/span>/);
                if (companyMatch) {
                    jobData.company = companyMatch[1].trim();
                }

                const locationMatch = html.match(/<div[^>]*class="companyLocation"[^>]*>(.*?)<\/div>/);
                if (locationMatch) {
                    jobData.location = locationMatch[1].trim();
                }

                const salaryMatch = html.match(/<div[^>]*class="salary-snippet"[^>]*>(.*?)<\/div>/);
                if (salaryMatch) {
                    jobData.salary = salaryMatch[1].trim();
                }

                // Extract job type from metadata
                const jobTypeMatch = html.match(/<div[^>]*class="metadata"[^>]*>(.*?)<\/div>/);
                if (jobTypeMatch) {
                    jobData.jobType = jobTypeMatch[1].replace(/<[^>]*>/g, '').trim();
                }

                // Extract posted date
                const dateMatch = html.match(/<span[^>]*class="date"[^>]*>(.*?)<\/span>/);
                if (dateMatch) {
                    jobData.postedDate = dateMatch[1].trim();
                }

                // Check for remote status in job card
                if (html.includes('Remote') || html.includes('remote') || html.includes('Work from home')) {
                    jobData.remote = true;
                }
            }

            console.log('Extracted job data:', jobData);
            return jobData;
        }

        // Function to extract job links from search results
        function extractJobLinks(html: string) {
            console.log('Extracting job links from HTML');
            const jobLinks: string[] = [];
            
            // Try different patterns for job links, focusing on tapItem class
            const patterns = [
                /<a[^>]*class="tapItem"[^>]*href="([^"]*)"[^>]*>/g,
                /<a[^>]*class="jcs-JobTitle"[^>]*href="([^"]*)"[^>]*>/g,
                /<a[^>]*data-jk="([^"]*)"[^>]*>/g,
                /<a[^>]*href="\/pagead\/clk\?mo=([^"]*)"[^>]*>/g,
                /<a[^>]*href="\/viewjob\?jk=([^"]*)"[^>]*>/g,
                /<a[^>]*href="\/rc\/clk\?jk=([^"]*)"[^>]*>/g,
                /<a[^>]*class="jobTitle"[^>]*href="([^"]*)"[^>]*>/g
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
        function getNextPageUrl(currentUrl: string, currentPage: number): string | null {
            console.log('Getting next page URL');
            if (currentPage >= 10) {
                console.log('Reached maximum page limit');
                return null;
            }

            // Extract the base URL and parameters
            const url = new URL(currentUrl);
            const searchParams = new URLSearchParams(url.search);
            
            // Update the start parameter
            const start = (currentPage - 1) * 10;
            searchParams.set('start', start.toString());
            
            // Reconstruct the URL
            url.search = searchParams.toString();
            const nextUrl = url.toString();
            
            console.log('Next page URL:', nextUrl);
            return nextUrl;
        }

        // Function to handle Cloudflare challenges
        async function handleCloudflareChallenge(html: string, url: string, proxyUrl: string): Promise<string> {
            console.log('Handling Cloudflare challenge');
            
            // Check if we got a Cloudflare challenge page
            if (html.includes('Security Check') || html.includes('cf-mitigated')) {
                console.log('Detected Cloudflare challenge page');
                
                // Wait longer before retrying
                const delay = Math.random() * 10000 + 10000;
                console.log(`Waiting ${Math.round(delay/1000)} seconds before retry`);
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // Get a new proxy URL
                const newProxyUrl = await proxyConfiguration?.newUrl();
                console.log('Using new proxy URL:', newProxyUrl);
                
                // Retry the request with new proxy and more browser-like headers
                const retryResponse = await gotScraping.get(url, {
                    proxyUrl: newProxyUrl,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
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
                        'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"',
                        'Sec-CH-UA': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                        'Sec-CH-UA-Mobile': '?0',
                        'Sec-CH-UA-Platform': '"Windows"',
                        'Sec-CH-UA-Bitness': '"64"',
                        'Sec-CH-UA-Arch': '"x86"',
                        'Sec-CH-UA-Full-Version': '"122.0.0.0"',
                        'Sec-CH-UA-Full-Version-List': '"Chromium";v="122.0.0.0", "Not(A:Brand";v="24.0.0.0", "Google Chrome";v="122.0.0.0"',
                        'Sec-CH-UA-Model': '""',
                        'Sec-CH-UA-Platform-Version': '"10.0.0"'
                    },
                    timeout: {
                        request: 30000
                    }
                });
                
                return retryResponse.body;
            }
            
            return html;
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
                    if (!proxyUrl) {
                        throw new Error('Failed to get proxy URL');
                    }
                    console.log('Using proxy URL:', proxyUrl);

                    // Make the request with got-scraping
                    console.log('Making request to search page');
                    const response = await gotScraping.get(currentUrl, {
                        proxyUrl,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
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
                            'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                            'sec-ch-ua-mobile': '?0',
                            'sec-ch-ua-platform': '"Windows"',
                            'Sec-CH-UA': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                            'Sec-CH-UA-Mobile': '?0',
                            'Sec-CH-UA-Platform': '"Windows"',
                            'Sec-CH-UA-Bitness': '"64"',
                            'Sec-CH-UA-Arch': '"x86"',
                            'Sec-CH-UA-Full-Version': '"122.0.0.0"',
                            'Sec-CH-UA-Full-Version-List': '"Chromium";v="122.0.0.0", "Not(A:Brand";v="24.0.0.0", "Google Chrome";v="122.0.0.0"',
                            'Sec-CH-UA-Model': '""',
                            'Sec-CH-UA-Platform-Version': '"10.0.0"'
                        },
                        timeout: {
                            request: 30000
                        }
                    });

                    console.log('Received response from search page');
                    let html = response.body;
                    
                    // Handle Cloudflare challenge if needed
                    html = await handleCloudflareChallenge(html, currentUrl, proxyUrl);
                    
                    // Debug HTML content
                    console.log('Response status:', response.statusCode);
                    console.log('Response headers:', response.headers);
                    console.log('HTML length:', html.length);
                    console.log('First 500 chars of HTML:', html.substring(0, 500));
                    console.log('Last 500 chars of HTML:', html.substring(html.length - 500));

                    // Extract job links
                    const jobLinks = extractJobLinks(html);
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

                            // Get job details
                            console.log('Making request to job page');
                            const jobResponse = await gotScraping.get(jobUrl, {
                                proxyUrl,
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                                    'Accept-Language': 'en-GB,en;q=0.9',
                                    'Accept-Encoding': 'gzip, deflate, br',
                                    'Connection': 'keep-alive',
                                    'Upgrade-Insecure-Requests': '1',
                                    'Sec-Fetch-Dest': 'document',
                                    'Sec-Fetch-Mode': 'navigate',
                                    'Sec-Fetch-Site': 'same-origin',
                                    'Sec-Fetch-User': '?1',
                                    'Cache-Control': 'max-age=0',
                                    'DNT': '1',
                                    'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                                    'sec-ch-ua-mobile': '?0',
                                    'sec-ch-ua-platform': '"Windows"',
                                    'Sec-CH-UA': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                                    'Sec-CH-UA-Mobile': '?0',
                                    'Sec-CH-UA-Platform': '"Windows"',
                                    'Sec-CH-UA-Bitness': '"64"',
                                    'Sec-CH-UA-Arch': '"x86"',
                                    'Sec-CH-UA-Full-Version': '"122.0.0.0"',
                                    'Sec-CH-UA-Full-Version-List': '"Chromium";v="122.0.0.0", "Not(A:Brand";v="24.0.0.0", "Google Chrome";v="122.0.0.0"',
                                    'Sec-CH-UA-Model': '""',
                                    'Sec-CH-UA-Platform-Version': '"10.0.0"'
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

                    // Get next page URL using start parameter
                    currentUrl = getNextPageUrl(currentUrl, currentPage + 1);
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