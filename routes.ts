import { Dataset, createPuppeteerRouter } from 'crawlee';
import { JobListing, CompanyDetails, IndeedInput } from './types.js';

export const router = createPuppeteerRouter();

// Handler for search results pages
router.addHandler('search', async ({ request, page, log, enqueueLinks }) => {
    log.info(`Processing search page: ${request.url}`);

    // Wait for job cards to load
    await page.waitForSelector('.job_seen_beacon');

    // Extract job listings from the current page
    const jobListings = await page.$$eval('.job_seen_beacon', (cards) => {
        return cards.map((card) => {
            const titleElement = card.querySelector('.jobTitle');
            const companyElement = card.querySelector('.companyName');
            const locationElement = card.querySelector('.companyLocation');
            const salaryElement = card.querySelector('.salary-snippet');
            const jobLink = card.querySelector('a.jcs-JobTitle') as HTMLAnchorElement;

            return {
                title: titleElement?.textContent?.trim() || '',
                company: companyElement?.textContent?.trim() || '',
                location: locationElement?.textContent?.trim() || '',
                salary: salaryElement?.textContent?.trim(),
                jobUrl: jobLink?.href || '',
            };
        });
    });

    // Save job listings to dataset
    for (const job of jobListings) {
        await Dataset.pushData(job);
    }

    // Check for next page and enqueue if exists
    const nextPageButton = await page.$('a[aria-label="Next Page"]');
    if (nextPageButton) {
        const nextPageUrl = await nextPageButton.evaluate((el) => (el as HTMLAnchorElement).href);
        await enqueueLinks({
            urls: [nextPageUrl],
            label: 'search'
        });
    }
});

// Handler for individual job listings
router.addHandler('job', async ({ request, page, log, enqueueLinks }) => {
    log.info(`Processing job listing: ${request.url}`);

    // Wait for job details to load
    await page.waitForSelector('#jobDescriptionText');

    const jobDetails = await page.evaluate(() => {
        const descriptionElement = document.querySelector('#jobDescriptionText');
        const companyElement = document.querySelector('.jobsearch-CompanyInfoContainer');
        const postedDateElement = document.querySelector('.jobsearch-JobMetadataFooter');
        const jobTypeElement = document.querySelector('.jobsearch-JobMetadataHeader-item');

        return {
            description: descriptionElement?.textContent?.trim() || '',
            companyUrl: (companyElement?.querySelector('a') as HTMLAnchorElement)?.href,
            postedDate: postedDateElement?.textContent?.trim(),
            jobType: jobTypeElement?.textContent?.trim(),
        };
    });

    // Update the job listing in the dataset
    await Dataset.pushData({
        ...request.userData.job,
        ...jobDetails,
    });

    // If parseCompanyDetails is true, enqueue the company page
    if (request.userData.parseCompanyDetails && jobDetails.companyUrl) {
        await enqueueLinks({
            urls: [jobDetails.companyUrl],
            label: 'company',
            userData: { companyName: request.userData.job.company }
        });
    }
});

// Handler for company pages
router.addHandler('company', async ({ request, page, log }) => {
    log.info(`Processing company page: ${request.url}`);

    const companyDetails = await page.evaluate(() => {
        const websiteElement = document.querySelector('a[data-tn-element="companyWebsite"]') as HTMLAnchorElement;
        const sizeElement = document.querySelector('[data-testid="companySize"]');
        const foundedElement = document.querySelector('[data-testid="companyFounded"]');
        const industryElement = document.querySelector('[data-testid="companyIndustry"]');
        const headquartersElement = document.querySelector('[data-testid="companyHeadquarters"]');
        const descriptionElement = document.querySelector('[data-testid="companyDescription"]');

        return {
            website: websiteElement?.href,
            size: sizeElement?.textContent?.trim(),
            founded: foundedElement?.textContent?.trim(),
            industry: industryElement?.textContent?.trim(),
            headquarters: headquartersElement?.textContent?.trim(),
            description: descriptionElement?.textContent?.trim(),
        };
    });

    // Save company details to dataset
    await Dataset.pushData({
        name: request.userData.companyName,
        ...companyDetails,
    });
});

// Default handler for search results
router.addDefaultHandler(async ({ request, page, log, enqueueLinks }) => {
    log.info(`Processing default page: ${request.url}`);
    await enqueueLinks({
        urls: [request.url],
        label: 'search'
    });
}); 